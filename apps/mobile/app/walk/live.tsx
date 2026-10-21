import { useIsFocused, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useApp } from '../../src/appContext';
import { LiveWalkScreen } from '../../src/features/walks/LiveWalkScreen';

export default function LiveWalk(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  return <LiveWalkScreen services={app.liveWalk} active={active}
    onFinished={(id) => { router.replace({ pathname: '/walk/[id]', params: { id } }); }}
    onDiscarded={() => { router.replace('/(tabs)/walks'); }}
    onLocationSettings={() => { router.push('/permission/location'); }} />;
}
