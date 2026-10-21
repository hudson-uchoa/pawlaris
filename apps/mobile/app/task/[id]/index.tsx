import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../../src/appContext';
import { TaskDetailScreen, type TaskDetailServices } from '../../../src/features/tasks/TaskDetailScreen';
import type { PhotoProofTarget } from '../../../src/features/dashboard/types';

export default function TaskDetail(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = app.sessionUser();
  const services = useMemo<TaskDetailServices | null>(() => {
    if (user === null) return null;
    return { clock: app.clock, sessionUser: () => user, mutations: app.mutations,
      readCompletionRange: app.readCompletionRange };
  }, [app.clock, app.mutations, app.readCompletionRange, user]);
  const edit = useCallback((taskId: string) => {
    router.push({ pathname: '../../task/[id]/edit', params: { id: taskId } });
  }, [router]);
  const takeProof = useCallback((target: PhotoProofTarget) => {
    router.push({ pathname: '../../camera', params: { mode: 'proof', taskId: target.taskId,
      occurrenceKey: target.occurrenceKey, ...(target.petId === null ? {} : { petId: target.petId }) } });
  }, [router]);
  const openPhoto = useCallback((id: string) => {
    router.push({ pathname: '../../photo/[id]', params: { id } });
  }, [router]);
  if (services === null) return <View />;
  return <TaskDetailScreen taskId={id} services={services} active={active} onEdit={edit}
    onPhotoRequired={takeProof} onOpenPhoto={openPhoto} />;
}
