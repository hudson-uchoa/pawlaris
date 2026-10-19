import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../../../src/appContext';
import { WeightFormScreen } from '../../../src/features/pets/WeightFormScreen';
import { strings } from '../../../src/i18n/strings';
import { useToast } from '../../../src/ui/primitives/Toast';

export default function PetWeight(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const user = app.sessionUser();
  if (user === null) return <View />;
  return <WeightFormScreen petId={id} active={active}
    services={{ clock: app.clock, sessionUser: () => user, mutations: app.mutations }}
    onSaved={() => { toast.show(strings.toasts.weightRecorded); }} onClose={() => { router.back(); }} />;
}
