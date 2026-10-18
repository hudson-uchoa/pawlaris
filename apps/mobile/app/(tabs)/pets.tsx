import type { ReactElement } from 'react';
import { PlaceholderScreen } from '../../src/features/shell/PlaceholderScreen';
import { strings } from '../../src/i18n/strings';

export default function Pets(): ReactElement {
  return <PlaceholderScreen title={strings.tabs.pets} testID="pets-placeholder" />;
}
