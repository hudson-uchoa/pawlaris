import { useIsFocused } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { FamilyScreen } from '../../src/features/family/FamilyScreen';

export default function Family(): ReactElement {
  const app = useApp();
  const active = useIsFocused();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <FamilyScreen services={{ sessionUser: () => user, connection: app.engine.state,
    lifecycle: app.lifecycle, actions: app.familyActions, copyText: app.copyText }} active={active} />;
}
