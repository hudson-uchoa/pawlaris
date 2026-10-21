import type { ReactElement } from 'react';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '../../src/appContext';
import { WalkDetailScreen } from '../../src/features/walks/WalkDetailScreen';

export default function WalkDetail(): ReactElement {
  const app = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const active = useIsFocused();
  const router = useRouter();
  return <WalkDetailScreen walkId={id} active={active}
    services={{ clock: app.clock, sessionUser: app.sessionUser,
      readLocalWalk: app.liveWalk.readLocalWalk, mutations: app.mutations }}
    onDiscarded={() => { router.replace('/(tabs)/walks'); }} />;
}
