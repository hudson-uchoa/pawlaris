import { localDate, splitKey, type DayViewItem, type Member, type Pet, type Completion } from '@pawlaris/shared';
import { Camera, Clock as ClockIcon } from 'lucide-react-native';
import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent, type LayoutRectangle, useWindowDimensions } from 'react-native';
import { cancelAnimation, ReduceMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { formatCarryOverDate } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import type { Clock } from '../../platform/clock';
import { useReplica } from '../../replica/useReplica';
import type { Mutations } from '../../sync/mutations';
import { ConstellationLine } from '../../ui/cosmos/ConstellationLine';
import { StarCheck } from '../../ui/cosmos/StarCheck';
import { hold } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { Card } from '../../ui/primitives/Card';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { CompletionAttribution } from './CompletionAttribution';
import { PetAvatar } from './PetAvatar';
import { PetToggle, type PetToggleProps } from './PetToggle';
import { UndoCompletionSheet } from './UndoCompletionSheet';

export interface TaskCardProps {
  item: DayViewItem;
  members: Readonly<Record<string, Member>>;
  viewerId: string;
  date: string;
  timezone: string;
  active: boolean;
  services: {
    clock: Clock;
    mutations: Pick<Mutations, 'createCompletion' | 'undoCompletion'>;
  };
  onOpenTask?: (taskId: string) => void;
  onHoldInGroup?: (taskId: string, occurrenceKey: string) => void;
  onMoveToDone?: (taskId: string, occurrenceKey: string) => void;
}

const PetControl = memo(function PetControl({ pet, onToggle, ...props }: Omit<PetToggleProps, 'onPress'> & {
  onToggle: (petId: string | null) => void;
}): ReactElement {
  const press = useCallback(() => { onToggle(pet.id); }, [onToggle, pet.id]);
  return <PetToggle {...props} pet={pet} onPress={press} />;
});

export const TaskCard = memo(function TaskCard({ item, members, viewerId, date, timezone, active, services,
  onOpenTask, onHoldInGroup, onMoveToDone }: TaskCardProps): ReactElement {
  const template = useReplica((state) => state.taskTemplates[item.taskId]);
  const animationActive = useAnimationActive(active);
  const complete = item.progress.total > 0 && item.progress.done >= item.progress.total;
  const readOnly = date > localDate(services.clock.now(), timezone);
  const waiting = useRef(false);
  const pressed = useRef(new Set<string | null>());
  const moveCallback = useRef(onMoveToDone);
  const moveProgress = useSharedValue(0);
  const [undoId, setUndoId] = useState<string | null>(null);
  const undo = item.completions.find((row) => row.id === undoId) ?? null;
  useLayoutEffect(() => { moveCallback.current = onMoveToDone; }, [onMoveToDone]);
  useLayoutEffect(() => { pressed.current.clear(); }, [item.completions]);
  const finishMove = useCallback(() => {
    if (!waiting.current) return;
    waiting.current = false;
    moveCallback.current?.(item.taskId, item.occurrenceKey);
  }, [item.taskId, item.occurrenceKey]);
  // A virtualized row can leave the tree during its ignition hold. Release
  // its section pin so a later mount cannot leave a done card in the old group.
  useLayoutEffect(() => () => { finishMove(); }, [finishMove]);
  useLayoutEffect(() => {
    cancelAnimation(moveProgress);
    if (!waiting.current) return;
    if (!complete || !animationActive) {
      finishMove();
      return;
    }
    moveProgress.set(0);
    // The hold is UI-thread time, even in Reduce Motion; it changes no visual
    // property. The parent then performs one layout transition (or snaps).
    moveProgress.set(withTiming(1, { duration: hold.completion, reduceMotion: ReduceMotion.Never }, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(finishMove);
    }));
    return () => { cancelAnimation(moveProgress); };
  }, [complete, animationActive, moveProgress, finishMove]);

  const toggle = useCallback((petId: string | null) => {
    if (readOnly) return;
    const completion = item.completions.find((row) => row.pet_id === petId);
    if (completion !== undefined) {
      setUndoId(completion.id);
      return;
    }
    // Photo capture is wired by P5-5; never create a photo-required record
    // without its proof in the meantime.
    if (template === undefined || template.requires_photo || item.orphan || pressed.current.has(petId)) return;
    pressed.current.add(petId);
    if (item.progress.done + pressed.current.size === item.progress.total) {
      waiting.current = true;
      onHoldInGroup?.(item.taskId, item.occurrenceKey);
    }
    services.mutations.createCompletion({ task_id: item.taskId, occurrence_key: item.occurrenceKey,
      pet_id: petId, completed_at: new Date(services.clock.now()).toISOString(), photo_asset_id: null, note: null });
  }, [readOnly, item, template, services.mutations, services.clock, onHoldInGroup]);
  const together = useCallback(() => { toggle(null); }, [toggle]);
  const dismissUndo = useCallback(() => { setUndoId(null); }, []);
  const confirmUndo = useCallback(() => {
    if (undo !== null && !readOnly) services.mutations.undoCompletion(undo.id);
    setUndoId(null);
  }, [undo, readOnly, services.mutations]);
  const openTask = useCallback(() => { onOpenTask?.(item.taskId); }, [onOpenTask, item.taskId]);

  const { width } = useWindowDimensions();
  const [bounds, setBounds] = useState({ width: Math.max(spacing.xxl * 2, width - spacing.md * 4), height: spacing.xxl * 2 });
  const [petLayouts, setPetLayouts] = useState<Readonly<Record<string, LayoutRectangle>>>({});
  const measurePets = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBounds((old) => old.width === width && old.height === height ? old : { width, height });
  }, []);
  const measureAvatar = useCallback((petId: string, layout: LayoutRectangle) => {
    setPetLayouts((old) => {
      const previous = old[petId];
      return previous?.x === layout.x && previous.y === layout.y && previous.width === layout.width
        && previous.height === layout.height ? old : { ...old, [petId]: layout };
    });
  }, []);
  const columns = 2;
  const petWidth = Math.max(0, (bounds.width - spacing.xs) / columns);
  const points = item.pets.map((pet, index) => {
    const layout = petLayouts[pet.id];
    return layout === undefined ? {
      x: index % columns * (petWidth + spacing.xs) + petWidth / 2,
      y: Math.floor(index / columns) * (spacing.xxl * 2 + spacing.xs) + spacing.xxl / 2,
    } : { x: layout.x + layout.width / 2, y: layout.y + spacing.xxl / 2 };
  });
  const done: Completion | undefined = item.completions[0];
  const body = <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {item.pets.slice(0, 3).map((pet: Pet, index) => <View key={pet.id}
        style={{ marginLeft: index === 0 ? 0 : -spacing.sm }}><PetAvatar pet={pet} /></View>)}
      {item.pets.length > 3 && <Text variant="caption">{strings.dashboard.extraPets(item.pets.length - 3)}</Text>}
    </View>
    <View style={{ gap: spacing.xxs, flex: 1, minWidth: 0 }}>
      <Text variant="label" numberOfLines={1} ellipsizeMode="tail">{item.title}</Text>
      {item.mode === 'together' && done !== undefined
        ? <CompletionAttribution completion={done} member={members[done.completed_by]} timezone={timezone} active={active} />
        : <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
          {item.assignedTo === null ? <Text color="accent">{strings.tasks.anyone}</Text>
            : item.assignedTo !== viewerId && <Text color="textMuted">
              {members[item.assignedTo]?.display_name ?? strings.format.unavailable}</Text>}
          {template?.reminder_class === 'critical' && <Text variant="caption" color="textMuted">{strings.tasks.reminders.critical}</Text>}
          {template?.requires_photo && <Icon glyph={Camera} color="textMuted" accessibilityLabel={strings.tasks.photo} />}
          {template?.timer_seconds !== null && template?.timer_seconds !== undefined
            && <Icon glyph={ClockIcon} color="textMuted" accessibilityLabel={strings.tasks.timer} />}
      </View>}
    </View>
    <Text variant="caption" color="textMuted">{item.originalDate !== date ? formatCarryOverDate(item.originalDate)
      : splitKey(item.occurrenceKey).time ?? strings.dashboard.allDay}</Text>
  </View>;
  return <Card testID={`task-card-${item.taskId}-${item.occurrenceKey}`}
    accessibilityLabel={item.title} active={active} style={{ gap: spacing.xs, padding: spacing.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      {onOpenTask === undefined ? body : <PressableScale accessibilityLabel={item.title}
        onPress={openTask} active={active} style={{ flex: 1, minWidth: 0 }}>{body}</PressableScale>}
      {item.mode === 'together' && <StarCheck checked={complete} accessibilityLabel={item.title}
        occurrenceKey={item.occurrenceKey}
        testID={`task-check-${item.taskId}-${item.occurrenceKey}`} active={active} disabled={readOnly}
        onPress={together} />}
      {item.mode === 'per_pet' && <Text variant="label">{item.progress.done}/{item.progress.total}</Text>}
    </View>
    {item.mode === 'per_pet' ? <>
      <View onLayout={measurePets} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <View pointerEvents="none" style={{ position: 'absolute' }}>
          <ConstellationLine points={points} width={bounds.width} height={bounds.height} complete={complete} active={active}
            testID={`task-constellation-${item.taskId}-${item.occurrenceKey}`} />
        </View>
        {item.pets.map((pet) => <PetControl key={pet.id} pet={pet} width={petWidth}
          occurrenceKey={item.occurrenceKey}
          completion={item.completions.find((row) => row.pet_id === pet.id) ?? null} members={members}
          timezone={timezone} active={active} disabled={readOnly} onToggle={toggle} onAvatarLayout={measureAvatar}
          testID={`task-pet-${item.taskId}-${item.occurrenceKey}-${pet.id}`} />)}
      </View>
    </> : null}
    <UndoCompletionSheet completion={undo} member={undo === null ? undefined : members[undo.completed_by]}
      timezone={timezone} active={active} onConfirm={confirmUndo} onDismiss={dismissUndo} />
  </Card>;
});
