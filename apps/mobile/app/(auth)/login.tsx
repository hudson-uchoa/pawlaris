import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useApp } from '../../src/appContext';
import { LoginScreen } from '../../src/features/auth/LoginScreen';

export default function Login(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  return <View testID="login-placeholder" onLayout={app.afterFirstPaint} style={{ flex: 1 }}>
    <LoginScreen services={{ session: app.session, lifecycle: app.lifecycle,
      connection: app.engine.state, sessionUser: app.sessionUser }}
      active={active} onLayout={app.afterFirstPaint}
      onRedeem={() => { router.push('./redeem'); }} />
  </View>;
}
