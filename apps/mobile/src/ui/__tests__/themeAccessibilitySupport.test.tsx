import { cleanup, render } from '@testing-library/react-native';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { dark, light } from '../tokens/color';
import { radius } from '../tokens/radius';
import { accessibilityProblems, pressables, targetProblems, themeProblems, type AuditNode } from './themeAccessibilitySupport';

afterEach(async () => { await cleanup(); });

async function tree(element: React.ReactElement): Promise<AuditNode> {
  const view = await render(element);
  if (view.root === null) throw new Error('Audit fixture did not render');
  return view.root;
}

test('P7-2 P9 audit lists every missing label and role, including disabled and long-press-only controls', async () => {
  const root = await tree(<View>
    <Pressable testID="missing-both" onPress={() => {}} />
    <Pressable testID="disabled" disabled onPress={() => {}} accessibilityLabel="Disabled" />
    <Pressable testID="long-press" onLongPress={() => {}} accessibilityRole="button" />
    <Pressable testID="hidden-control" accessible={false} onPress={() => {}} />
    <View testID="decoration" />
    <ScrollView><Text>Scrollable text</Text></ScrollView>
  </View>);
  expect(pressables(root)).toHaveLength(4);
  expect(accessibilityProblems(root)).toEqual([
    'View[missing-both]: missing accessibilityLabel, accessibilityRole',
    'View[disabled]: missing accessibilityRole',
    'View[long-press]: missing accessibilityLabel',
    'View[hidden-control]: missing accessibilityLabel, accessibilityRole',
  ]);
});

test('P7-2 Q-33 native inputs require labels and preserve native edit-text roles', async () => {
  const root = await tree(<View>
    <TextInput testID="labelled" accessibilityLabel="Name" />
    <TextInput testID="unlabelled" />
  </View>);
  expect(pressables(root)).toEqual([]);
  expect(accessibilityProblems(root)).toHaveLength(1);
  expect(accessibilityProblems(root)[0]).toContain('[unlabelled]: missing accessibilityLabel');
});

test('P7-2 P9 audit resolves style arrays and both numeric and edge hitSlop', async () => {
  const root = await tree(<View>
    <Pressable testID="numeric-slop" style={[{ width: 20 }, { height: 20 }]} hitSlop={12} />
    <Pressable testID="edge-slop" style={{ width: 32, height: 40 }}
      hitSlop={{ left: 6, right: 6, top: 2, bottom: 2 }} />
    <Pressable testID="minimum" style={{ minWidth: 44, minHeight: 44 }} />
    <Pressable testID="too-short" style={{ width: 44, height: 43 }} />
    <Pressable testID="too-narrow" style={{ width: 43, minHeight: 44 }} />
  </View>);
  expect(pressables(root)).toHaveLength(5);
  expect(targetProblems(root)).toEqual([
    'View[too-short]: minimum hit size 44x43 dp',
    'View[too-narrow]: minimum hit size 43x44 dp',
  ]);
});

test.each(['light', 'dark'] as const)('P7-2 %s audit compares resolved root, card and primary text with exact tokens', async (scheme) => {
  const color = scheme === 'light' ? light : dark;
  const root = await tree(<View style={{ backgroundColor: color.bg }}>
    <View style={{ backgroundColor: color.surface, borderRadius: radius.card }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: color.text }}>Title</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ color: color.textMuted }}>Subtitle</Text>
    </View>
  </View>);
  expect(themeProblems(root, scheme)).toEqual([]);
  expect(themeProblems(root, scheme === 'light' ? 'dark' : 'light')).toHaveLength(5);
});

test('P7-2 card audit catches a wrong semantic background and primary text even within the same theme', async () => {
  const root = await tree(<View style={{ backgroundColor: light.bg }}>
    <View testID="card" style={{ backgroundColor: light.bg, borderRadius: radius.card }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: light.textMuted }}>Title</Text>
    </View>
  </View>);
  expect(themeProblems(root, 'light')).toEqual([
    'View[card]: card background must equal light.surface',
    'View[card]: card primary text must equal light.text',
  ]);
});
