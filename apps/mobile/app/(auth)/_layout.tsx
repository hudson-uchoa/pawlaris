import type { ReactElement } from 'react';
import { Stack } from 'expo-router/stack';

export default function AuthLayout(): ReactElement {
  return <Stack screenOptions={{ headerShown: false }} />;
}
