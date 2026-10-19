import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { HealthDetailScreen } from '../../src/features/health/HealthDetailScreen';

export default function HealthDetail(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const { id, assetId } = useLocalSearchParams<{ id: string; assetId?: string }>();
  if (app.sessionUser() === null) return <View />;
  return <HealthDetailScreen eventId={id} services={{ clock: app.clock, mutations: app.mutations }}
    {...(assetId === undefined ? {} : { attachmentAssetId: assetId })}
    active={active} onClose={() => { router.back(); }}
    onAttachment={(mode) => { router.push({ pathname: '../camera', params: {
      mode, returnTo: '../health/[id]', returnId: id,
    } }); }} />;
}
