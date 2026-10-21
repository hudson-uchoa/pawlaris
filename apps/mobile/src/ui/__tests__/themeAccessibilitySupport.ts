import type { RenderResult } from '@testing-library/react-native';
import { StyleSheet, type Insets, type StyleProp, type TextStyle } from 'react-native';
import type { ThemeScheme } from '../theme';
import { dark, identity, light } from '../tokens/color';
import { elevation } from '../tokens/elevation';
import { radius } from '../tokens/radius';

export type AuditNode = NonNullable<RenderResult['root']>;

export function nodes(root: AuditNode): AuditNode[] {
  return [root, ...root.children.flatMap((child) => typeof child === 'string' ? [] : nodes(child))];
}

export function resolvedStyle(node: AuditNode): TextStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {};
}

export function elementName(node: AuditNode): string {
  let name: unknown = node.props.testID ?? node.props.accessibilityLabel;
  let parent = node.parent;
  while (name === undefined && parent !== null) {
    const parentName: unknown = parent.props.testID ?? parent.props.accessibilityLabel;
    if (parentName !== undefined) name = `${String(parentName)}/${node.type}`;
    parent = parent.parent;
  }
  return `${node.type}[${String(name ?? 'unlabelled')}]`;
}

export function cards(root: AuditNode): AuditNode[] {
  return nodes(root).filter((node) => {
    const style = resolvedStyle(node);
    return (style.borderRadius === radius.card
      && (style.backgroundColor !== undefined || style.elevation === elevation.card))
      || (typeof node.props.testID === 'string' && node.props.testID.startsWith('walk-row-'));
  });
}

function isInput(node: AuditNode): boolean {
  return /TextInput/.test(node.type);
}

export function pressables(root: AuditNode): AuditNode[] {
  // Inspect native press handlers, not roles: a missing role must stay visible
  // to this audit. Disabled Pressables still install the responder handlers.
  return nodes(root).filter((node) => !isInput(node) && (
    typeof node.props.onPress === 'function'
    || (typeof node.props.onClick === 'function' && typeof node.props.onResponderGrant === 'function'
      && typeof node.props.onResponderRelease === 'function')
  ));
}

export function accessibilityProblems(root: AuditNode): string[] {
  const controls = new Set([...pressables(root), ...nodes(root).filter(isInput)]);
  return [...controls].flatMap((node) => {
    const missing: string[] = [];
    if (typeof node.props.accessibilityLabel !== 'string' || node.props.accessibilityLabel.trim() === '') {
      missing.push('accessibilityLabel');
    }
    // Q-33: Android supplies edit-text semantics; RN has no text-input role.
    if (!isInput(node) && !node.props.accessibilityRole) missing.push('accessibilityRole');
    return missing.length === 0 ? [] : [`${elementName(node)}: missing ${missing.join(', ')}`];
  });
}

export function targetProblems(root: AuditNode): string[] {
  return pressables(root).flatMap((node) => {
    const style = resolvedStyle(node);
    const slop = node.props.hitSlop as number | Insets | undefined;
    const inset = (edge: keyof Insets): number => typeof slop === 'number' ? slop : slop?.[edge] ?? 0;
    const numeric = (value: unknown): number => typeof value === 'number' ? value : 0;
    const width = Math.max(numeric(style.width), numeric(style.minWidth)) + inset('left') + inset('right');
    const height = Math.max(numeric(style.height), numeric(style.minHeight)) + inset('top') + inset('bottom');
    return width >= 44 && height >= 44 ? [] : [`${elementName(node)}: minimum hit size ${width}x${height} dp`];
  });
}

export function themeProblems(root: AuditNode, scheme: ThemeScheme): string[] {
  const color = scheme === 'light' ? light : dark;
  const all = nodes(root);
  const problems: string[] = [];
  // Layout-only wrappers (KeyboardAwareForm, safe area) can be transparent.
  // The first painted surface must still be the screen's bg, never a card.
  const paintedRoot = all.find((node) => resolvedStyle(node).backgroundColor !== undefined);
  if (paintedRoot === undefined || resolvedStyle(paintedRoot).backgroundColor !== color.bg) {
    problems.push(`${paintedRoot === undefined ? 'root' : elementName(paintedRoot)}: root background must equal ${scheme}.bg`);
  }
  const textColors: readonly string[] = [color.text, color.textMuted, color.accent, color.onAccent,
    color.starText, color.success, color.warning, color.danger, ...identity.map((entry) => entry[scheme])];
  const cardNodes = cards(root);
  for (const node of cardNodes) {
    if (resolvedStyle(node).backgroundColor !== color.surface) {
      problems.push(`${elementName(node)}: card background must equal ${scheme}.surface`);
    }
    const title = nodes(node).find((child) => child.type === 'Text');
    if (title === undefined || resolvedStyle(title).color !== color.text) {
      problems.push(`${elementName(node)}: card primary text must equal ${scheme}.text`);
    }
  }
  for (const node of all) {
    const style = resolvedStyle(node);
    if (node !== paintedRoot && !cardNodes.includes(node)
      && style.backgroundColor !== undefined && style.backgroundColor !== 'transparent'
      && ![...Object.values(color), ...identity.map((entry) => entry[scheme])]
        .some((token) => token === style.backgroundColor)) {
      problems.push(`${elementName(node)}: background colour must equal a ${scheme} token or identity shade`);
    }
    if (node.type === 'Text' || isInput(node)) {
      if (typeof style.color !== 'string' || !textColors.includes(style.color)) {
        problems.push(`${elementName(node)}: text colour must equal a ${scheme} text token`);
      }
      if (node.props.maxFontSizeMultiplier !== 1.3) {
        problems.push(`${elementName(node)}: maxFontSizeMultiplier must equal 1.3`);
      }
    }
  }
  return problems;
}
