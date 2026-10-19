import { memo, useEffect, type ReactElement, type ReactNode } from 'react';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { duration } from '../../ui/motion/tokens';
import { dashboardMotion } from './motion';

export interface DashboardEntryProps {
  id: string;
  index: number;
  enabled: boolean;
  entered: Set<string>;
  children: ReactNode;
}

export const DashboardEntry = memo(function DashboardEntry({ id, index, enabled, entered, children }: DashboardEntryProps): ReactElement {
  const progress = useSharedValue(enabled && index < dashboardMotion.firstItems && !entered.has(id) ? 0 : 1);
  const style = useAnimatedStyle(() => ({ opacity: progress.get(),
    transform: [{ translateY: dashboardMotion.rise * (1 - progress.get()) }] }));
  useEffect(() => {
    const firstMount = !entered.has(id);
    entered.add(id);
    if (firstMount && enabled && index < dashboardMotion.firstItems) {
      progress.set(0);
      progress.set(withDelay(index * dashboardMotion.stagger, withTiming(1, { duration: duration.base })));
    } else progress.set(1);
    return () => { cancelAnimation(progress); };
  }, [id, index, enabled, entered, progress]);
  return <Animated.View testID={`entry-${id}`} style={style}>{children}</Animated.View>;
});
