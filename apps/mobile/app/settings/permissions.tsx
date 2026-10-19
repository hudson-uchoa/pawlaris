import { useIsFocused } from 'expo-router';
import type { ReactElement } from 'react';
import { PermissionsScreen } from '../../src/features/settings/PermissionsScreen';

export default function Permissions(): ReactElement {
  const active = useIsFocused();
  return <PermissionsScreen active={active} />;
}
