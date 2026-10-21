import { useIsFocused, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { PermissionsScreen } from '../../src/features/settings/PermissionsScreen';

export default function Permissions(): ReactElement {
  const active = useIsFocused();
  const router = useRouter();
  return <PermissionsScreen active={active} onNotifications={() => { router.push('../permission/notifications'); }} />;
}
