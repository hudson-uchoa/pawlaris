import { useEffect, useState, type ReactElement } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { WalksScreen } from '../../src/features/walks/WalksScreen';
import type { LocationState } from '../../src/walks/permissions';
import { useWalkPermissions } from '../../src/walks/useWalkPermissions';
import { Text } from '../../src/ui/primitives/Text';
import { strings } from '../../src/i18n/strings';

export default function Walks(): ReactElement {
  const app = useApp();
  const permissions = useWalkPermissions();
  const router = useRouter();
  const active = useIsFocused();
  const [location, setLocation] = useState<LocationState>('denied');
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const unsubscribe = permissions.subscribe((state) => { if (mounted) setLocation(state); });
    void permissions.start().then(() => permissions.readLocationState()).then((state) => {
      if (mounted) setLocation(state);
    }).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; unsubscribe(); };
  }, [permissions, active]);
  const openPermission = (): void => { router.push('/permission/location'); };
  return <View testID="walks-placeholder" style={{ flex: 1 }}>
    {failed && <Text accessibilityRole="alert">{strings.settings.operationFailed}</Text>}
    <WalksScreen services={{ clock: app.clock, sessionUser: app.sessionUser,
      readLocalWalk: app.liveWalk.readLocalWalk, mutations: app.mutations }}
    active={active && !starting} locationState={location} onStart={(petId) => {
      if (starting || !active) return;
      setStarting(true);
      void permissions.readLadder().then(async (steps) => {
        if (steps.length > 0) { openPermission(); return; }
        await app.liveWalk.tracker.start(petId);
        router.push('/walk/live');
      }).catch(() => { setFailed(true); }).finally(() => { setStarting(false); });
    }} onResume={() => { router.push('/walk/live'); }}
    onOpenWalk={(id) => { router.push({ pathname: '/walk/[id]', params: { id } }); }}
    onRequestLocation={openPermission} onOpenSettings={openPermission} />
  </View>;
}
