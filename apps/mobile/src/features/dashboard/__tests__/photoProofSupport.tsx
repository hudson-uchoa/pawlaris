import { localDate, type TaskTemplate } from '@pawlaris/shared';
import { cleanup, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { selectDayView } from '../../../replica/selectors';
import { ReplicaProvider, useReplica } from '../../../replica/useReplica';
import { fakeCamera } from '../../../testing/fakeCamera';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { createPhotoCapture } from '../../pets/capture';
import { TaskCard } from '../TaskCard';
import type { PhotoProofTarget } from '../types';
import { dashboardContext, type DashboardContext } from './support';

const timezone = 'America/Sao_Paulo';
const contexts: DashboardContext[] = [];

export function photoProofLifecycle(): void {
  const initialAppState = AppState.currentState;
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    AppState.currentState = 'active';
    jest.mocked(useColorScheme).mockReturnValue('dark');
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await cleanup();
    for (const c of contexts.splice(0)) {
      const requests = [...c.http.requests];
      c.dispose();
      expect(requests).toEqual([]);
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
    AppState.currentState = initialAppState;
  });
}

export async function photoProofContext(mode: TaskTemplate['completion_mode'] = 'together') {
  const c = await dashboardContext();
  contexts.push(c);
  // The family-local test day is later than syncContext's session expiry.
  await c.session.adopt({ access_token: 'fake-proof-access', refresh_token: 'fake-proof-refresh',
    access_expires_at: new Date(c.clock.now() + 900_000).toISOString(), user: c.sessionUser });
  const pet = c.seedPet();
  const second = c.seedPet({ name: 'Second pet' });
  const task = c.seedTask({ requires_photo: true, times_of_day: [], completion_mode: mode,
    pet_ids: [pet.id, second.id] });
  const date = localDate(c.clock.now(), timezone);
  const target: PhotoProofTarget = { taskId: task.id, occurrenceKey: date,
    petId: mode === 'per_pet' ? pet.id : null };
  const camera = fakeCamera(c.fileSystem);
  const capture = createPhotoCapture(camera.device, c.files, c.ids);
  const onPhotoRequired = jest.fn<void, [PhotoProofTarget]>();
  const onOpenPhoto = jest.fn<void, [string]>();
  const onClose = jest.fn();
  const checkId = mode === 'together' ? `task-check-${task.id}-${date}`
    : `task-pet-${task.id}-${date}-${pet.id}`;
  return { ...c, ...camera, task, pet, second, date, target, capture,
    onPhotoRequired, onOpenPhoto, onClose, checkId };
}

export type PhotoProofContext = Awaited<ReturnType<typeof photoProofContext>>;

export function PhotoProofProviders({ c, children }: { c: PhotoProofContext; children: ReactNode }) {
  return <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    {children}
  </AssetFilesProvider></ReplicaProvider>;
}

function ReplicaPhotoCard({ c }: { c: PhotoProofContext }) {
  const members = useReplica((state) => state.members);
  const item = useReplica((state) => {
    const view = selectDayView(state, { date: c.date, now: c.clock.now(), me: c.sessionUser.id, scope: 'all' });
    return [...view.overdue, ...view.now, ...view.later, ...view.done]
      .find((row) => row.taskId === c.task.id && row.occurrenceKey === c.date);
  });
  if (item === undefined) throw new Error('The seeded photo-proof occurrence is missing');
  return <TaskCard item={item} members={members} viewerId={c.sessionUser.id}
    date={c.date} timezone={timezone} active services={{ clock: c.clock, mutations: c.mutations }}
    onOpenTask={c.onOpenTask} onPhotoRequired={c.onPhotoRequired} onOpenPhoto={c.onOpenPhoto} />;
}

export async function paintPhotoCard(c: PhotoProofContext) {
  return render(<PhotoProofProviders c={c}><ReplicaPhotoCard c={c} /></PhotoProofProviders>);
}
