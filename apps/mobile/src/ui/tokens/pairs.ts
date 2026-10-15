import type { ColorToken } from '../theme';
import { identity } from './color';

export type ColorSource = ColorToken | { identity: (typeof identity)[number]['name'] };
export type ContrastPair = {
  name: string;
  foreground: ColorSource;
  background: ColorSource;
  kind: 'text' | 'graphic';
};

const textColors = ['text', 'textMuted', 'accent', 'starText', 'warning', 'danger'] as const;
const surfaces = ['bg', 'surface', 'surfaceSunken'] as const;

// Register rendered combinations here; decorative borders and ambient art
// do not convey information. Success text is used on bg or surface only.
export const pairs: readonly ContrastPair[] = [
  ...textColors.flatMap((foreground) => surfaces.map((background) => ({
    name: `${foreground}/${background}`, foreground, background, kind: 'text' as const,
  }))),
  ...(['text', 'textMuted', 'accent'] as const).map((foreground) => ({
    name: `${foreground}/accentSoft`, foreground, background: 'accentSoft' as const,
    kind: 'text' as const,
  })),
  { name: 'success/bg', foreground: 'success', background: 'bg', kind: 'text' },
  { name: 'success/surface', foreground: 'success', background: 'surface', kind: 'text' },
  { name: 'onAccent/accent', foreground: 'onAccent', background: 'accent', kind: 'text' },
  { name: 'surface/textMuted/graphic', foreground: 'surface', background: 'textMuted', kind: 'graphic' },
  ...(['textMuted', 'accent'] as const).flatMap((foreground) => surfaces.map((background) => ({
    name: `${foreground}/${background}/graphic`, foreground, background, kind: 'graphic' as const,
  }))),
  { name: 'star/bg/graphic', foreground: 'star', background: 'bg', kind: 'graphic' },
  { name: 'star/surface/graphic', foreground: 'star', background: 'surface', kind: 'graphic' },
  ...identity.flatMap((entry): ContrastPair[] => [
    { name: `${entry.name}/bg`, foreground: { identity: entry.name }, background: 'bg', kind: 'text' },
    { name: `${entry.name}/surface`, foreground: { identity: entry.name }, background: 'surface', kind: 'text' },
    { name: `onAccent/${entry.name}`, foreground: 'onAccent', background: { identity: entry.name }, kind: 'graphic' },
  ]),
];
