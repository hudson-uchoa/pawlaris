import { useCallback, type ReactElement } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { useApp } from '../../src/appContext';
import { DashboardScreen } from '../../src/features/dashboard/DashboardScreen';

export default function Dashboard(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const add = useCallback(() => { router.push('../task/new'); }, [router]);
  const manage = useCallback(() => { router.push('../tasks'); }, [router]);
  const openPet = useCallback((id: string) => {
    router.push({ pathname: '../pet/[id]', params: { id } });
  }, [router]);
  return <DashboardScreen services={app} active={active} onAdd={add} onManage={manage} onOpenPet={openPet} />;
}
