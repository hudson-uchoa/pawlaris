import type { ReactElement } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { strings } from '../../i18n/strings';
import { Text } from '../primitives/Text';
import { accessibility } from '../tokens/accessibility';
import { signature } from '../tokens/cosmos';
import { InsurgeMark } from './insurgeMark';

export type PoweredByProps = {
  active: boolean;
  href?: string;
  testID?: string;
};

export function PoweredBy({ active, href, testID }: PoweredByProps): ReactElement {
  const accessibilityLabel = `${strings.brand.poweredBy} ${strings.brand.insurge}`;
  const content = <View style={{ flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'center', gap: signature.gap }}>
    <InsurgeMark active={active} {...(testID === undefined ? {} : { testID: `${testID}-mark` })} />
    <Text variant="caption" color="textMuted" accessible={false}>
      <Text variant="caption" color="textMuted" accessible={false}>{strings.brand.poweredBy}</Text>
      {' '}
      <Text variant="label" color="text" accessible={false}>{strings.brand.insurge}</Text>
    </Text>
  </View>;
  if (href === undefined) {
    return <View testID={testID} accessible accessibilityLabel={accessibilityLabel}
      style={{ alignItems: 'center', justifyContent: 'center' }}>{content}</View>;
  }
  return <Pressable testID={testID} accessible accessibilityRole="link" accessibilityLabel={accessibilityLabel}
    onPress={() => { void Linking.openURL(href); }}
    style={{ minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget,
      alignItems: 'center', justifyContent: 'center' }}>{content}</Pressable>;
}
