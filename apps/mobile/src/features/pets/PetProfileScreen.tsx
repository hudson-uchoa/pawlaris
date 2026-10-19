import { identityIndexForId, localDate, type DayViewItem, type WeightEntry } from '@pawlaris/shared';
import { useContext, useMemo, useRef, useState, type ReactElement } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { AssetImage } from '../../assets/AssetImage';
import { formatDateTime, formatDecimal, formatDistance, formatDuration, formatPetSummary, formatTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { selectDayView } from '../../replica/selectors';
import { useReplica } from '../../replica/useReplica';
import { Orbit } from '../../ui/cosmos/Orbit';
import { Starfield } from '../../ui/cosmos/Starfield';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { Avatar } from '../../ui/primitives/Avatar';
import { Button } from '../../ui/primitives/Button';
import { Card } from '../../ui/primitives/Card';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';
import { HealthTimelineSection } from '../health/HealthTimelineSection';
import { petWeights } from './petWeights';
import type { PetScreenProps } from './types';
import { WeightChart } from './WeightChart';

export type PetProfileScreenProps = PetScreenProps & {
  petId: string;
  onEdit(): void;
  onAddWeight(): void;
  onAddHealth(): void;
  onOpenHealth(id: string): void;
  onWalks(): void;
};

export function PetProfileScreen({ services, petId, active, onEdit, onAddWeight, onAddHealth, onOpenHealth, onWalks }: PetProfileScreenProps): ReactElement {
  const state = useReplica((snapshot) => snapshot);
  const { color } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext);
  const focused = useAnimationActive(active);
  const now = services.clock.now();
  const me = services.sessionUser().id;
  const pet = state.pets[petId];
  const family = state.family;
  const weights = useMemo(() => petWeights(state.weightEntries, petId), [state.weightEntries, petId]);
  const care = useMemo(() => {
    if (state.family === null) return [];
    const view = selectDayView(state, { now, me, scope: 'all', date: localDate(now, state.family.timezone) });
    return [...view.overdue, ...view.now, ...view.later, ...view.done]
      .filter((item) => item.pets.some((candidate) => candidate.id === petId));
  }, [state, now, me, petId]);
  const walks = useMemo(() => Object.values(state.walks)
    .filter((walk) => walk.pet_id === petId && walk.status === 'finished' && walk.deleted_at === null)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id)).slice(0, 3),
  [state.walks, petId]);
  const [headerHeight, setHeaderHeight] = useState(spacing.xxl * 6);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleted = useRef<string | null>(null);
  const contentWidth = Math.max(0, width - 2 * spacing.md);
  if (family === null || pet === undefined) {
    return <Skeleton width={contentWidth} height={spacing.xxl * 4} active={focused} />;
  }
  const placeholder = <Avatar petId={pet.id} species={pet.species} accessibilityLabel={pet.name} size={spacing.xxl * 2} />;
  function completionLabel(item: DayViewItem): string | null {
    const completion = item.completions.find((row) => row.pet_id === (item.mode === 'together' ? null : petId));
    if (completion === undefined) return null;
    return [state.members[completion.completed_by]?.display_name,
      formatTime(Date.parse(completion.completed_at), family?.timezone ?? 'UTC')].filter(Boolean).join(' · ');
  }
  return <ScrollView testID="pet-profile" style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.lg }}>
    <View testID="pet-header" onLayout={(event) => { setHeaderHeight(event.nativeEvent.layout.height); }}
      style={{ alignItems: 'center', padding: spacing.lg, gap: spacing.sm, borderRadius: radius.card, overflow: 'hidden' }}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Starfield seed={identityIndexForId(pet.id)} width={contentWidth} height={headerHeight} active={focused} />
      </View>
      <Orbit petId={pet.id} size={spacing.xxl * 2 + spacing.lg} active={focused} satellite testID={`pet-orbit-${pet.id}`}>
        <View style={{ width: spacing.xxl * 2, height: spacing.xxl * 2, borderRadius: radius.avatar, overflow: 'hidden' }}>
          {pet.avatar_asset_id === null ? placeholder
            : <AssetImage assetId={pet.avatar_asset_id} placeholder={placeholder} accessibilityLabel={pet.name} />}
        </View>
      </Orbit>
      <Text variant="title" accessibilityRole="header">{pet.name}</Text>
      <Text variant="caption" color="textMuted">{formatPetSummary(pet, now, family.timezone)}</Text>
      <Button testID="pet-edit" label={strings.pets.edit} accessibilityLabel={strings.pets.edit} onPress={onEdit} active={focused} />
    </View>
    <View style={{ gap: spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">{strings.weights.value}</Text>
      {weights[0] !== undefined && <Text testID="weight-latest" variant="title">
        {strings.weights.kilograms(formatDecimal(weights[0].weight_kg, 2))}
      </Text>}
      <WeightChart entries={weights} width={contentWidth} height={spacing.xxl * 4} timezone={family.timezone} active={focused} />
      <Button testID="weight-add" label={strings.weights.add} accessibilityLabel={strings.weights.add} onPress={onAddWeight} active={focused} />
      {weights.slice(0, 5).map((entry) => <WeightEntryRow key={entry.id} entry={entry} timezone={family.timezone}
        active={focused} onDelete={setDeleteId} />)}
    </View>
    <View testID="pet-care" style={{ gap: spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">{strings.pets.careToday}</Text>
      {care.map((item) => {
        const label = completionLabel(item);
        return <Card key={`${item.taskId}:${item.occurrenceKey}`} accessibilityLabel={item.title}
          testID={`pet-care-${item.taskId}-${item.occurrenceKey}`}>
          <Text variant="label">{item.title}</Text>
          <Text variant="caption" color="textMuted">{item.slotMs === null ? strings.format.allDay : formatTime(item.slotMs, family.timezone)}</Text>
          {label !== null && <Text variant="caption">{label}</Text>}
        </Card>;
      })}
    </View>
    <HealthTimelineSection petId={petId} active={focused} onAdd={onAddHealth} onOpen={onOpenHealth} />
    {pet.species === 'dog' && <View testID="pet-walks" style={{ gap: spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">{strings.tabs.walks}</Text>
      {walks.map((walk) => <View key={walk.id} testID={`pet-walk-${walk.id}`}>
        <Text variant="label">{formatDateTime(Date.parse(walk.started_at), family.timezone)}</Text>
        <Text variant="caption" color="textMuted">{[formatDistance(walk.distance_m), formatDuration(walk.duration_s)].join(' · ')}</Text>
      </View>)}
      <Button label={strings.pets.viewAll} accessibilityLabel={strings.pets.viewAll} active={focused} onPress={onWalks} />
    </View>}
    <Sheet visible={deleteId !== null} active={focused} accessibilityLabel={strings.weights.delete}
      dismissLabel={strings.dismiss} onDismiss={() => { setDeleteId(null); }}>
      <Button label={strings.weights.delete} accessibilityLabel={strings.weights.delete} active={focused} onPress={() => {
        if (deleteId === null || deleted.current === deleteId) return;
        services.mutations.deleteWeight(deleteId);
        deleted.current = deleteId;
        setDeleteId(null);
      }} />
    </Sheet>
  </ScrollView>;
}

function WeightEntryRow({ entry, timezone, active, onDelete }: {
  entry: WeightEntry; timezone: string; active: boolean; onDelete(id: string): void;
}): ReactElement {
  const label = `${strings.weights.kilograms(formatDecimal(entry.weight_kg, 2))} · ${formatDateTime(Date.parse(entry.measured_at), timezone)}`;
  const gesture = useMemo(() => Gesture.Pan().enabled(active).activeOffsetX(-spacing.xs)
    .failOffsetY([-spacing.xs, spacing.xs]).withTestId(`weight-entry-${entry.id}-pan`)
    .onEnd((event) => { if (event.translationX < -spacing.xxl) scheduleOnRN(onDelete, entry.id); }), [active, entry.id, onDelete]);
  return <GestureDetector gesture={gesture}>
    <PressableScale testID={`weight-entry-${entry.id}`} accessibilityLabel={label} active={active}
      onLongPress={() => { onDelete(entry.id); }} style={{ paddingVertical: spacing.xs, gap: spacing.xxs }}>
      <Text variant="label">{label}</Text>
      {entry.note !== null && <Text variant="caption" color="textMuted">{entry.note}</Text>}
    </PressableScale>
  </GestureDetector>;
}
