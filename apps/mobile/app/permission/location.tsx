import type { ReactElement } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { LocationPermissionScreen } from '../../src/features/walks/LocationPermissionScreen';
import { useWalkPermissions } from '../../src/walks/useWalkPermissions';

export default function Location(): ReactElement {
  const permissions = useWalkPermissions();
  const active = useIsFocused();
  const router = useRouter();
  return <LocationPermissionScreen permissions={permissions} active={active}
    onComplete={() => { router.back(); }} />;
}
