import type { ReactElement } from 'react';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';
import type { DashboardTaskCardProps } from './DashboardTaskCard';

export interface TaskCardProps extends DashboardTaskCardProps {
  active: boolean;
  services: {
    clock: Clock;
    mutations: Pick<Mutations, 'createCompletion' | 'undoCompletion'>;
  };
  onOpenTask?: (taskId: string) => void;
  onMoveToDone?: () => void;
}

export function TaskCard(_props: TaskCardProps): ReactElement {
  throw new Error('not implemented');
}
