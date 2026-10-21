import type { ReactElement } from 'react';
import { PlaceholderScreen } from '../../src/features/shell/PlaceholderScreen';
import { strings } from '../../src/i18n/strings';

export default function WalkDetail(): ReactElement {
  return <PlaceholderScreen title={strings.tabs.walks} testID="walk-detail-placeholder" />;
}
