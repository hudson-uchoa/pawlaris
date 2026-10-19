import { useIsFocused } from 'expo-router';
import type { ReactElement } from 'react';
import { useApp } from '../../src/appContext';
import { DiagnosticsScreen } from '../../src/features/settings/DiagnosticsScreen';

export default function Diagnostics(): ReactElement {
  const app = useApp();
  const active = useIsFocused();
  return <DiagnosticsScreen services={app.diagnostics} active={active} />;
}
