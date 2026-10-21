import type { AuthUser, Completion } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';

export interface TaskDetailServices {
  clock: Clock;
  sessionUser(): AuthUser;
  mutations: Pick<Mutations, 'createCompletion' | 'undoCompletion'>;
  readCompletionRange(from: string, to: string): readonly Completion[];
}

export interface TaskDetailScreenProps {
  taskId: string;
  services: TaskDetailServices;
  active: boolean;
  onEdit(taskId: string): void;
}

export function TaskDetailScreen(_props: TaskDetailScreenProps): ReactElement | null {
  return null;
}
