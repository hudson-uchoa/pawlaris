import type { ReactElement } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { SettingsScreen } from '../../src/features/settings/SettingsScreen';

export default function Settings(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <SettingsScreen services={{ sessionUser: () => user, connection: app.engine.state,
    lifecycle: app.lifecycle }} active={active}
    onOpen={(destination) => { router.push(`../settings/${destination}`); }} />;
}
