import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../src/appContext';
import { TaskFormScreen } from '../../src/features/tasks/TaskFormScreen';

export default function NewTask(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const { petId, category } = useLocalSearchParams<{ petId?: string; category?: string }>();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <TaskFormScreen services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
    {...(typeof petId === 'string' ? { initialPetId: petId } : {})}
    {...(category === 'vet' ? { initialCategory: category } : {})}
    active={active} onClose={() => { router.back(); }} />;
}
