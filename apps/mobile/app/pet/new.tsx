import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { PetFormScreen } from '../../src/features/pets/PetFormScreen';

export default function NewPet(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const { assetId } = useLocalSearchParams<{ assetId?: string }>();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <PetFormScreen services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
    {...(assetId === undefined ? {} : { avatarAssetId: assetId })}
    active={active} onClose={() => { router.back(); }}
    onAvatar={() => { router.push({ pathname: '../camera', params: { mode: 'avatar', returnTo: '../pet/new' } }); }} />;
}
