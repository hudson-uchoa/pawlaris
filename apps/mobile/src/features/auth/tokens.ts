import { pawStar } from '../../ui/cosmos/glyphs';
import { spacing } from '../../ui/tokens/spacing';

const markSize = 128;

// Auth layout choices; the mark's clearance follows spec 06 section 4.11.
export const authLayout = {
  skySeed: 42,
  markSize,
  markClearSpace: markSize * 100 / pawStar.size,
  formMaxWidth: 384,
  signatureHeight: spacing.lg,
  signatureBottomGap: spacing.lg,
} as const;
