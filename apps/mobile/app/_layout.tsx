import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../src/appContext';
import { createAppRuntime, productionDependencies, type AppDependencies } from '../src/bootstrap';
import { strings } from '../src/i18n/strings';
import { duration } from '../src/ui/motion/tokens';
import { HeroProvider } from '../src/ui/motion/hero';
import { useReduceMotion } from '../src/ui/motion/useReduceMotion';
import { ToastProvider } from '../src/ui/primitives/Toast';

void SplashScreen.preventAutoHideAsync();

export type RootLayoutProps = { dependencies?: AppDependencies };

export default function RootLayout({ dependencies }: RootLayoutProps = {}): ReactElement {
  const [runtime] = useState(() => createAppRuntime(dependencies ?? productionDependencies()));
  const painted = useRef(false);
  const handleFirstPaint = useCallback(() => {
    if (painted.current) return;
    painted.current = true;
    void SplashScreen.hideAsync();
    runtime.afterFirstPaint();
  }, [runtime]);
  const provided = useMemo(() => ({ ...runtime, afterFirstPaint: handleFirstPaint }), [runtime, handleFirstPaint]);
  useEffect(() => () => runtime.dispose(), [runtime]);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
    <AppProvider runtime={provided}><ToastProvider dismissLabel={strings.dismiss}>
      <HeroProvider><Navigation /></HeroProvider>
    </ToastProvider></AppProvider>
  </SafeAreaProvider></GestureHandlerRootView>;
}

function Navigation(): ReactElement {
  const app = useApp();
  const connection = useSyncExternalStore(app.engine.state.subscribe, app.engine.state.getState);
  const signedIn = app.sessionUser() !== null && connection.status !== 'signed_out';
  const reduced = useReduceMotion();
  const theme = app.theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return <ThemeProvider value={{ ...theme, colors: { ...theme.colors,
    background: app.theme.color.bg, card: app.theme.color.surface, text: app.theme.color.text,
    border: app.theme.color.border, primary: app.theme.color.accent, notification: app.theme.color.star,
  } }}>
    <StatusBar barStyle={app.theme.scheme === 'dark' ? 'light-content' : 'dark-content'} />
    <Stack screenOptions={{ headerShown: false, animation: reduced ? 'fade' : 'slide_from_right',
      ...(reduced ? { animationDuration: duration.reducedFade } : {}),
    }}>
      <Stack.Protected guard={!signedIn}><Stack.Screen name="(auth)" /></Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="pet/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pet/[id]/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pet/[id]/index" options={{ animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="pet/[id]/weight" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pet/[id]/health/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="health/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="task/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="task/[id]/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="settings/password" />
        <Stack.Screen name="settings/family" />
        <Stack.Screen name="settings/diagnostics" />
        <Stack.Screen name="settings/permissions" />
      </Stack.Protected>
    </Stack>
  </ThemeProvider>;
}
