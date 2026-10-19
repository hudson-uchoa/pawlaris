import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../../src/appContext';
import { PetProfileScreen } from '../../../src/features/pets/PetProfileScreen';
import { ToastHost } from '../../../src/ui/primitives/Toast';

export default function PetProfile(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <View style={{ flex: 1 }}>
    <PetProfileScreen petId={id} active={active}
      services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
      onEdit={() => { router.push({ pathname: '../../pet/[id]/edit', params: { id } }); }}
      onAddWeight={() => { router.push({ pathname: '../../pet/[id]/weight', params: { id } }); }}
      onWalks={() => { router.navigate('../../(tabs)/walks'); }} />
    <ToastHost active={active} />
  </View>;
}
