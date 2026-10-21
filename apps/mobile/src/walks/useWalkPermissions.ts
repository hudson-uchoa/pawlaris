import { useEffect, useMemo } from 'react';
import { useApp } from '../appContext';
import { createLocationPermissions, type LocationPermissions } from './permissions';
import { createExpoWalkPermissions } from './port';

export function useWalkPermissions(): LocationPermissions {
  const { preferences, clock } = useApp();
  const permissions = useMemo(() => createLocationPermissions({ kv: preferences, clock,
    platform: createExpoWalkPermissions() }), [preferences, clock]);
  useEffect(() => () => { permissions.dispose(); }, [permissions]);
  return permissions;
}
