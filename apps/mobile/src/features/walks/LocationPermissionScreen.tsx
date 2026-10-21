import type { ReactElement } from 'react';
import type { LocationPermissions, TrackingMode } from '../../walks/permissions';

export interface LocationPermissionScreenProps {
  permissions: LocationPermissions;
  active: boolean;
  onComplete(mode: TrackingMode): void;
}

export function LocationPermissionScreen(_props: LocationPermissionScreenProps): ReactElement | null {
  return null;
}
