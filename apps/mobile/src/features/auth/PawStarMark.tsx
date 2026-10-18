import { useId, type ReactElement } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { pawStar } from '../../ui/cosmos/glyphs';
import { useTheme } from '../../ui/theme';
import { authLayout } from './tokens';

export function PawStarMark(): ReactElement {
  const { color, scheme } = useTheme();
  const id = useId();
  const padGradient = `${id}-pad`;
  const glowGradient = `${id}-glow`;
  return <View accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ padding: authLayout.markClearSpace }}>
    <Svg width={authLayout.markSize} height={authLayout.markSize}
      viewBox={`0 0 ${pawStar.size} ${pawStar.size}`}>
      <Defs>
        <LinearGradient id={padGradient} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor={color.padTop} />
          <Stop offset="100%" stopColor={color.padBottom} />
        </LinearGradient>
        <RadialGradient id={glowGradient}>
          <Stop offset="0%" stopColor={color.star} stopOpacity={pawStar.glow.opacity[scheme]} />
          <Stop offset="100%" stopColor={color.star} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={pawStar.glow.x} cy={pawStar.glow.y} r={pawStar.glow.radius} fill={`url(#${glowGradient})`} />
      <Path d={pawStar.pad} fill={`url(#${padGradient})`} />
      {pawStar.toes.map((toe) => <G key={toe.x} transform={`rotate(${toe.rotation} ${toe.x} ${toe.y})`}>
        <Path d={toe.path} fill={color.star} />
      </G>)}
    </Svg>
  </View>;
}
