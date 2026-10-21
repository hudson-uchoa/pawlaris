import { Circle, Group, Line, LinearGradient, Skia, vec } from '@shopify/react-native-skia';
import { memo, useContext, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { cancelAnimation, clamp, Easing, ReduceMotion, useDerivedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { shootingStars } from '../tokens/cosmos';
import { CelebrationContext } from './celebration';
import { Supernova } from './Supernova';
import { starDepth } from './sky';

// Draw nodes are composed inside Starfield's canvas.
export type ShootingStarsProps = {
  width: number;
  height: number;
  play: boolean;
  active: boolean;
};

const Meteor = memo(function Meteor({ time, index, width, height, color, startY }: {
  time: SharedValue<number>; index: number; width: number; height: number;
  color: string; startY: number;
}): ReactElement {
  const dx = width + 2 * shootingStars.tailLength;
  const dy = height * shootingStars.verticalTravel;
  const distance = Math.hypot(dx, dy);
  const tail = { x: -shootingStars.tailLength * dx / distance, y: -shootingStars.tailLength * dy / distance };
  const opacity = useDerivedValue(() => {
    const elapsed = time.get() - index * shootingStars.stagger;
    return elapsed >= 0 && elapsed < shootingStars.crossing ? 1 : 0;
  }, [time, index]);
  const transform = useDerivedValue(() => {
    const fraction = clamp((time.get() - index * shootingStars.stagger) / shootingStars.crossing, 0, 1);
    return [{ translateX: -shootingStars.tailLength + dx * fraction },
      { translateY: startY * height + dy * fraction }];
  }, [time, index, dx, dy, startY, height]);
  const colors = useMemo(() => {
    const transparent = Skia.Color(color);
    transparent[3] = 0;
    return [transparent, color];
  }, [color]);
  return <Group transform={transform} opacity={opacity}>
    <Line p1={tail} p2={vec(0, 0)} strokeWidth={shootingStars.tailWidth} strokeCap="round">
      <LinearGradient start={tail} end={vec(0, 0)} colors={colors} />
    </Line>
    <Circle cx={0} cy={0} r={shootingStars.headRadius} color={color} />
  </Group>;
});

export function ShootingStars({ width, height, play, active }: ShootingStarsProps): ReactElement | null {
  const sky = useContext(CelebrationContext);
  if (sky === null) throw new Error('ShootingStars must be rendered inside Starfield');
  const { time } = sky;
  const { color } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active && sky.active);
  const consumed = useRef(false);
  const supernovaTransform = useDerivedValue(() => [
    { translateY: sky.origin === undefined ? 0 : -sky.scroll.get() * starDepth(sky.origin.magnitude) },
  ]);
  useEffect(() => () => { time.set(shootingStars.duration); }, [time]);
  useEffect(() => {
    const elapsed = time.get();
    if (!play) consumed.current = false;
    if (!play || !animationActive) {
      time.set(shootingStars.duration);
    } else if (!consumed.current) {
      consumed.current = true;
      if (reduced) {
        time.set(-1);
        // This is a timed cut, so the system must not elide the hold itself.
        time.set(withDelay(shootingStars.duration, withTiming(shootingStars.duration, { duration: 0 }), ReduceMotion.Never));
      } else {
        time.set(0);
        time.set(withTiming(shootingStars.duration, { duration: shootingStars.duration, easing: Easing.linear }));
      }
    } else if (reduced && elapsed >= 0 && elapsed < shootingStars.duration) {
      // Switching to Reduce Motion preserves the remaining celebration window.
      time.set(-1);
      time.set(withDelay(shootingStars.duration - elapsed, withTiming(shootingStars.duration, { duration: 0 }), ReduceMotion.Never));
    } else {
      time.set(shootingStars.duration);
    }
    return () => { cancelAnimation(time); };
  }, [time, play, animationActive, reduced]);
  if (!play || !animationActive || reduced) return null;
  return <Group>
    {sky.origin !== undefined && <Group transform={supernovaTransform}>
      <Supernova time={time} x={sky.origin.x} y={sky.origin.y} seed={sky.seed} />
    </Group>}
    {shootingStars.startY.map((startY, index) => <Meteor key={index} time={time} index={index}
      width={width} height={height} color={color.star} startY={startY} />)}
  </Group>;
}
