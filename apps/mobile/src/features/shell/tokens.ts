import { icon } from '../../ui/tokens/icon';
import { spacing } from '../../ui/tokens/spacing';

// Spec 06 sections 4.4 and 4.7. Unspecified sizes use the existing tokens.
export const shell = {
  syncSize: 14,
  syncStroke: 1.5,
  syncDot: spacing.xxs,
  tabIconSize: icon.large,
  tabStarSize: spacing.xxs,
  tabIconGap: spacing.xxs,
} as const;
