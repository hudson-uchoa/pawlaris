import type { ReactElement } from 'react';
import type { TaskScreenProps } from './types';

export type TasksListScreenProps = TaskScreenProps & {
  onOpenTask(taskId: string): void;
};

export function TasksListScreen(_props: TasksListScreenProps): ReactElement {
  throw new Error('not implemented');
}
