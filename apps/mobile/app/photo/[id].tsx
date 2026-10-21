import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { PhotoProofViewer } from '../../src/features/dashboard/PhotoProofViewer';

export default function Photo(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const active = useIsFocused();
  return <PhotoProofViewer assetId={id} active={active} onClose={() => { router.back(); }} />;
}
