import type { ReactElement } from 'react';
import type { SyncEvents } from '../../sync/events';

export type SyncToastHostProps = { events: SyncEvents; active: boolean };

export function SyncToastHost(props: SyncToastHostProps): ReactElement | null {
  void props;
  throw new Error('Sync toast host not implemented');
}
