import { useSyncExternalStore, type ReactElement } from 'react';
import { useIsFocused } from 'expo-router';
import { useApp } from '../../src/appContext';
import { RedeemScreen } from '../../src/features/auth/RedeemScreen';

export default function Redeem(): ReactElement {
  const app = useApp();
  const active = useIsFocused();
  const connection = useSyncExternalStore(app.engine.state.subscribe, app.engine.state.getState);
  return <RedeemScreen services={{ session: app.session, lifecycle: app.lifecycle,
    connection: app.engine.state, sessionUser: app.sessionUser }}
    active={active} online={connection.status !== 'offline'} onLayout={app.afterFirstPaint} />;
}
