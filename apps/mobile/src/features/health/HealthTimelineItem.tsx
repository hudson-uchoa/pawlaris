import type { HealthEvent } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export type HealthTimelineItemProps = {
  event: HealthEvent;
  timezone: string;
  active: boolean;
  onOpen(id: string): void;
};

export function HealthTimelineItem(_props: HealthTimelineItemProps): ReactElement {
  throw new Error('not implemented');
}
