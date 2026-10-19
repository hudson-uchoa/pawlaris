import { localDate, type HealthEvent } from '@pawlaris/shared';
import { Activity, FileText, Image as ImageGlyph, Pill, Scissors, Stethoscope, Syringe, type LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useContext, useSyncExternalStore, type ReactElement } from 'react';
import { View } from 'react-native';
import { AssetImage } from '../../assets/AssetImage';
import { AssetFilesContext } from '../../assets/useAssetFile';
import { formatFullDate, formatShortDate } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Card } from '../../ui/primitives/Card';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';

const glyphs: Record<HealthEvent['type'], LucideIcon> = {
  vaccine: Syringe, medication: Pill, vet_visit: Stethoscope,
  symptom: Activity, procedure: Scissors, other: FileText,
};

export type HealthTimelineItemProps = {
  event: HealthEvent;
  timezone: string;
  active: boolean;
  onOpen(id: string): void;
};

export const HealthTimelineItem = memo(function HealthTimelineItem({ event, timezone, active, onOpen }: HealthTimelineItemProps): ReactElement {
  const open = useCallback(() => { onOpen(event.id); }, [onOpen, event.id]);
  return <Card accessibilityLabel={event.title} style={{ gap: spacing.xs }}>
    <PressableScale testID={`health-event-${event.id}`} accessibilityLabel={event.title} active={active}
      onPress={open} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Icon glyph={glyphs[event.type]} accessibilityLabel={strings.health.types[event.type]} color="accent" />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="label">{event.title}</Text>
        <Text variant="caption" color="textMuted">{formatFullDate(localDate(Date.parse(event.occurred_at), timezone))}</Text>
        {event.next_due_on !== null && <Text variant="caption" color="textMuted">
          {strings.health.nextDue(formatShortDate(event.next_due_on))}
        </Text>}
      </View>
    </PressableScale>
    {event.attachment_asset_id !== null && <HealthAttachment assetId={event.attachment_asset_id} active={active} onOpen={open} />}
  </Card>;
});

export function HealthAttachment({ assetId, active, onOpen }: { assetId: string; active: boolean; onOpen(): void }): ReactElement {
  const files = useContext(AssetFilesContext);
  if (files === null) throw new Error('HealthAttachment requires an AssetFilesProvider');
  const subscribe = useCallback((listener: () => void) => active
    ? files.subscribeUploadState(listener) : () => {}, [files, active]);
  const snapshot = useCallback(() => files.uploadState(assetId), [files, assetId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const { color } = useTheme();
  const label = state === 'to_upload' ? strings.health.photoUploading
    : state === 'failed' ? strings.health.photoFailed : state === null ? strings.health.photoPending : null;
  return <View style={{ gap: spacing.xxs }}>
    <PressableScale accessibilityLabel={strings.pets.photo} active={active} onPress={onOpen}
      style={{ width: spacing.xxl + spacing.md, height: spacing.xxl + spacing.md,
      borderRadius: radius.chip, backgroundColor: color.surfaceSunken, overflow: 'hidden' }}>
      <AssetImage assetId={assetId} accessibilityLabel={strings.pets.photo}
        placeholder={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Icon glyph={ImageGlyph} color="textMuted" />
        </View>} />
    </PressableScale>
    {state === 'failed' ? <PressableScale testID="photo-retry" accessibilityLabel={strings.health.photoFailed} active={active}
      onPress={() => { files.retryUpload(assetId); }} style={{ justifyContent: 'center' }}>
      <Text variant="caption" color="danger">{strings.health.photoFailed}</Text>
    </PressableScale> : label !== null && <Text variant="caption" color="textMuted">{label}</Text>}
  </View>;
}
