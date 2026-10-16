import type { ReactElement } from 'react';
import type { ConnectionObservable } from '../../sync/engine';

export type SyncIndicatorProps = {
  connection: ConnectionObservable;
  active: boolean;
};

export function SyncIndicator(props: SyncIndicatorProps): ReactElement | null {
  void props;
  throw new Error('Sync indicator not implemented');
}
