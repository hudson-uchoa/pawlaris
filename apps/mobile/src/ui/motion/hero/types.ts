import type { ReactNode } from 'react';
import type { View, ViewProps } from 'react-native';
import type { AnimatedProps, AnimatedRef, MeasuredDimensions, SharedValue } from 'react-native-reanimated';

type HeroStyle = AnimatedProps<ViewProps>['style'];

export type HeroProviderProps = { children: ReactNode; active?: boolean };
export type HeroElement = {
  ref: AnimatedRef<View>;
  collapsable: false;
  style: HeroStyle;
  onLayout(): void;
};
export type HeroContent = { avatar: ReactNode; name: ReactNode };
export type HeroSource = {
  avatar: HeroElement;
  name: HeroElement;
  contentStyle: HeroStyle;
  start(content: HeroContent, navigate: () => void): void;
};
export type HeroTarget = {
  avatar: HeroElement;
  name: HeroElement;
  contentStyle: HeroStyle;
  settled: boolean;
  back(navigate: () => void): void;
};

export type Frames = { avatar: MeasuredDimensions; name: MeasuredDimensions };
export type Endpoint = {
  avatar: AnimatedRef<View>;
  name: AnimatedRef<View>;
  opacity: SharedValue<number>;
  bodyOpacity: SharedValue<number>;
};
export type Direction = 'forward' | 'back';
export type EndpointRole = 'source' | 'target';
