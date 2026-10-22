import type { Completion, Member } from '@pawlaris/shared';
import { memo, useLayoutEffect, useRef, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { formatTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { duration } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { identity } from '../../ui/tokens/color';
import { e2eIDs } from '../shell/e2eIDs';

export const CompletionAttribution = memo(function CompletionAttribution({ completion, member, timezone, active }: {
  completion: Completion;
  member: Member | undefined;
  timezone: string;
  active: boolean;
}): ReactElement {
  const { scheme } = useTheme();
  const entry = identity.find((shade) => shade.key === member?.color) ?? identity[0];
  const label = strings.dashboard.completedBy(member?.display_name ?? strings.format.unavailable,
    formatTime(Date.parse(completion.completed_at), timezone));
  // Retain only the outgoing rendered label for the visual crossfade. The
  // current attribution always comes straight from the replica's winning row.
  const current = useRef({ id: completion.id, label, color: entry[scheme] });
  const outgoing = useRef<{ label: string; color: string } | null>(null);
  const changed = current.current.id !== completion.id;
  if (changed) outgoing.current = current.current;
  current.current = { id: completion.id, label, color: entry[scheme] };
  const animationActive = useAnimationActive(active);
  const reduced = useReduceMotion();
  const progress = useSharedValue(1);
  const previousId = useRef(completion.id);
  useLayoutEffect(() => {
    const replaced = previousId.current !== completion.id;
    previousId.current = completion.id;
    cancelAnimation(progress);
    progress.set(1);
    if (replaced && animationActive) {
      progress.set(0);
      progress.set(withTiming(1, { duration: reduced ? duration.reducedFade : duration.quick }));
    }
    return () => { cancelAnimation(progress); };
  }, [completion.id, animationActive, reduced, progress]);
  const incomingStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const outgoingStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  return <View>
    {outgoing.current !== null && <Animated.View pointerEvents="none" accessible={false}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, outgoingStyle]}>
      <Text variant="caption" style={{ color: outgoing.current.color }}>{outgoing.current.label}</Text>
    </Animated.View>}
    <Animated.View style={incomingStyle}>
      <Text testID={e2eIDs.attribution(completion.task_id, completion.occurrence_key)} variant="caption" style={{ color: entry[scheme] }}>{label}</Text>
    </Animated.View>
  </View>;
});
