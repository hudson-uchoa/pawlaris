import type { ReactElement } from 'react';
import { useOptionalApp } from '../../src/appContext';
import { PlaceholderScreen } from '../../src/features/shell/PlaceholderScreen';
import { strings } from '../../src/i18n/strings';

export default function Login(): ReactElement {
  const app = useOptionalApp();
  return <PlaceholderScreen title={strings.appName} testID="login-placeholder"
    {...(app === null ? {} : { onLayout: app.afterFirstPaint })} />;
}
