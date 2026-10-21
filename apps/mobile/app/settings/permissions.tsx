import { useIsFocused, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { PermissionsScreen } from '../../src/features/settings/PermissionsScreen';
import { useWalkPermissions } from '../../src/walks/useWalkPermissions';

export default function Permissions(): ReactElement {
  const active = useIsFocused();
  const router = useRouter();
  const walkPermissions = useWalkPermissions();
  return <PermissionsScreen active={active} walkPermissions={walkPermissions}
    onLocation={() => { router.push('../permission/location'); }}
    onNotifications={() => { router.push('../permission/notifications'); }} />;
}
