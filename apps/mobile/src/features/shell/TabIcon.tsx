import type { ReactElement } from 'react';

export type TabName = 'index' | 'pets' | 'walks' | 'settings';
export type TabIconProps = { name: TabName; focused: boolean; active: boolean };

export function TabIcon(props: TabIconProps): ReactElement {
  void props;
  throw new Error('Tab icon not implemented');
}
