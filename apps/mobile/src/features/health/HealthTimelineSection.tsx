import type { ReactElement } from 'react';

export type HealthTimelineSectionProps = {
  petId: string;
  active: boolean;
  onAdd(): void;
  onOpen(id: string): void;
};

export function HealthTimelineSection(_props: HealthTimelineSectionProps): ReactElement {
  throw new Error('not implemented');
}
