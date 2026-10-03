import { Stack } from 'expo-router';

export default function RootLayout() {
  // Q-2 records the scope of this native stack's internal runtime assets.
  return <Stack screenOptions={{ headerShown: false }} />;
}
