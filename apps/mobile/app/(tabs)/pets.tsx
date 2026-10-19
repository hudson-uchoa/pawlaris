import type { ReactElement } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { PetsGridScreen } from '../../src/features/pets/PetsGridScreen';

export default function Pets(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <PetsGridScreen services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
    active={active} onAdd={() => { router.push('../pet/new'); }}
    onOpenPet={(id) => { router.push({ pathname: '../pet/[id]', params: { id } }); }} />;
}
