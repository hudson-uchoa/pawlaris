import type { DateKey } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export interface CompleteSkyHeaderProps {
  allDone: boolean;
  date: DateKey;
  today: DateKey;
}

// P5-9 red scaffold: the completed-day header has no output yet.
export function CompleteSkyHeader(_props: CompleteSkyHeaderProps): ReactElement | null {
  return null;
}
