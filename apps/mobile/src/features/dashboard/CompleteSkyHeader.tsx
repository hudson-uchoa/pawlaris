import type { DateKey } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import { strings } from '../../i18n/strings';
import { Text } from '../../ui/primitives/Text';

export interface CompleteSkyHeaderProps {
  allDone: boolean;
  date: DateKey;
  today: DateKey;
}

export function CompleteSkyHeader({ allDone, date, today }: CompleteSkyHeaderProps): ReactElement | null {
  if (!allDone || date !== today) return null;
  return <Text variant="heading" color="starText" accessibilityRole="header">{strings.dashboard.completeSky}</Text>;
}
