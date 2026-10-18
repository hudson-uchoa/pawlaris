import type { ReactElement } from 'react';
import { useApp } from '../../src/appContext';
import { PlaceholderScreen } from '../../src/features/shell/PlaceholderScreen';
import { strings } from '../../src/i18n/strings';
import { useReplica } from '../../src/replica/useReplica';

export default function Dashboard(): ReactElement {
  const app = useApp();
  const ready = useReplica((state) => state.ready && state.family !== null);
  return <PlaceholderScreen title={strings.tabs.index} testID="dashboard-placeholder" loading={!ready}
    onLayout={() => {
      app.afterFirstPaint();
      if (ready) app.marker.dashboardInteractive();
    }} />;
}
