import type { DateKey } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export interface DayHeaderProps {
  date: DateKey;
  today: DateKey;
  active: boolean;
  onChange(date: DateKey): void;
}

export function DayHeader(_props: DayHeaderProps): ReactElement {
  throw new Error('not implemented');
}
