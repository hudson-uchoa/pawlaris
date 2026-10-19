import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { TasksListScreen } from '../../src/features/tasks/TasksListScreen';

export default function Tasks(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const user = app.sessionUser();
  const openTask = useCallback((id: string) => {
    // P5-4 will replace this temporary edit destination with task/[id].
    router.push({ pathname: '../task/[id]/edit', params: { id } });
  }, [router]);
  if (user === null) return <View />;
  return <TasksListScreen services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
    active={active} onOpenTask={openTask} />;
}
