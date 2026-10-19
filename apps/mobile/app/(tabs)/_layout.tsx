import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useApp } from '../../src/appContext';
import { SyncIndicator } from '../../src/features/shell/SyncIndicator';
import { SyncToastHost } from '../../src/features/shell/SyncToastHost';
import { TabBar } from '../../src/features/shell/TabBar';
import { TabIcon, type TabName } from '../../src/features/shell/TabIcon';
import { strings } from '../../src/i18n/strings';
import { duration } from '../../src/ui/motion/tokens';
import { useAnimationActive } from '../../src/ui/motion/useAnimationActive';
import { Text } from '../../src/ui/primitives/Text';
import { typography } from '../../src/ui/tokens/type';

export default function TabsLayout(): ReactElement {
  const app = useApp();
  const focused = useIsFocused();
  const active = useAnimationActive(focused);
  const [tabBarHeight, setTabBarHeight] = useState(0);
  return <View style={{ flex: 1 }}>
    <Tabs tabBar={(props) => <TabBar {...props} onHeight={setTabBarHeight} />} screenOptions={{
    animation: active ? 'fade' : 'none', transitionSpec: { animation: 'timing', config: { duration: duration.micro } },
    headerStyle: { backgroundColor: app.theme.color.bg }, headerTintColor: app.theme.color.text,
    headerTitleStyle: typography.heading, sceneStyle: { backgroundColor: app.theme.color.bg },
    headerRight: () => <HeaderIndicator />,
    tabBarActiveTintColor: app.theme.color.star, tabBarInactiveTintColor: app.theme.color.textMuted,
    tabBarStyle: { backgroundColor: app.theme.color.surface, borderTopColor: app.theme.color.border },
  }}>
    {(Object.keys(strings.tabs) as TabName[]).map((name) => <Tabs.Screen key={name} name={name} options={{
      title: strings.tabs[name], tabBarAccessibilityLabel: strings.tabs[name],
      headerShown: name !== 'index',
      tabBarLabel: ({ focused: selected }) => <Text variant="caption" color={selected ? 'star' : 'textMuted'}>{strings.tabs[name]}</Text>,
      tabBarIcon: ({ focused: selected }) => <TabIcon name={name} focused={selected} active={active} />,
    }} />)}
    </Tabs>
    <SyncToastHost events={app.events} active={active} bottomInset={tabBarHeight} />
  </View>;
}

function HeaderIndicator(): ReactElement {
  const app = useApp();
  const focused = useIsFocused();
  return <SyncIndicator connection={app.engine.state} active={focused} />;
}
