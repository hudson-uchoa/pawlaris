import { useIsFocused, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { PasswordScreen } from '../../src/features/settings/PasswordScreen';

export default function Password(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const user = app.sessionUser();
  if (user === null) return <View />;
  const services = { sessionUser: () => user, connection: app.engine.state,
    lifecycle: app.lifecycle, actions: { changePassword: app.changePassword } };
  return <PasswordScreen services={services} active={active} onClose={() => { router.back(); }} />;
}
