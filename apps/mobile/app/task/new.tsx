import { useIsFocused, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { TaskFormScreen } from '../../src/features/tasks/TaskFormScreen';

export default function NewTask(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <TaskFormScreen services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
    active={active} onClose={() => { router.back(); }} />;
}
