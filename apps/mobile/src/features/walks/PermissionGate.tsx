import type { ReactElement, ReactNode } from 'react';
import type { LocationState } from '../../walks/permissions';

export interface PermissionGateProps {
  state: LocationState;
  active: boolean;
  children: ReactNode;
  onRequest(): void;
  onOpenSettings(): void;
}

export function PermissionGate(_props: PermissionGateProps): ReactElement | null {
  return null;
}
