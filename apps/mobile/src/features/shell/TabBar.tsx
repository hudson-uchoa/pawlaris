import type { ReactElement } from 'react';
import { View } from 'react-native';
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs';

export function TabBar({ onHeight, ...props }: BottomTabBarProps & { onHeight: (height: number) => void }): ReactElement {
  return <View onLayout={(event) => { onHeight(event.nativeEvent.layout.height); }}>
    <BottomTabBar {...props} />
  </View>;
}
