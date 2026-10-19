import type { ReactElement } from 'react';
import type { TaskScreenProps } from './types';

export type TaskFormScreenProps = TaskScreenProps & {
  taskId?: string;
  onClose(): void;
};

export function TaskFormScreen(_props: TaskFormScreenProps): ReactElement {
  throw new Error('not implemented');
}
