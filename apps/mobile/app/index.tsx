import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { strings } from '../src/i18n/strings';

export default function Index(): ReactElement {
  return <Text maxFontSizeMultiplier={1.3}>{strings.appName}</Text>;
}
