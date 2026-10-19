import type { ReactElement, ReactNode } from 'react';
import type { StyleProp, View, ViewStyle } from 'react-native';
import type { AnimatedRef } from 'react-native-reanimated';

export type HeroProviderProps = {
  children: ReactNode;
  active?: boolean;
};

export type HeroElement = {
  ref: AnimatedRef<View>;
  style: StyleProp<ViewStyle>;
  onLayout(): void;
};

export type HeroContent = {
  avatar: ReactNode;
  name: ReactNode;
};

export type HeroSource = {
  avatar: HeroElement;
  name: HeroElement;
  start(content: HeroContent, navigate: () => void): void;
};

export type HeroTarget = {
  avatar: HeroElement;
  name: HeroElement;
  contentStyle: StyleProp<ViewStyle>;
  settled: boolean;
};

export function HeroProvider(props: HeroProviderProps): ReactElement {
  void props;
  throw new Error('not implemented');
}

export function useHeroSource(id: string): HeroSource {
  void id;
  throw new Error('not implemented');
}

export function useHeroTarget(id: string): HeroTarget {
  void id;
  throw new Error('not implemented');
}
