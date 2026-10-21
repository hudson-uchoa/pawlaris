import type { ReactElement } from 'react';
import type { LocationPermissions } from '../../walks/permissions';

export interface WalkPermissionRowsProps {
  permissions: LocationPermissions;
  active: boolean;
  onLocation(): void;
}

export function WalkPermissionRows(_props: WalkPermissionRowsProps): ReactElement | null {
  return null;
}
