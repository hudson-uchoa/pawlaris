import type { ReactElement } from 'react';
import { useIsFocused } from 'expo-router';
import { useApp } from '../../src/appContext';
import { RedeemScreen } from '../../src/features/auth/RedeemScreen';

export default function Redeem(): ReactElement {
  const app = useApp();
  const active = useIsFocused();
  return <RedeemScreen services={{ session: app.session, lifecycle: app.lifecycle,
    connection: app.engine.state, sessionUser: app.sessionUser }}
    active={active} onLayout={app.afterFirstPaint} />;
}
