import type { ReactElement, ReactNode } from 'react';

export type AssetImageProps = {
  assetId: string;
  placeholder: ReactNode;
  accessibilityLabel: string;
  testID?: string;
};

export function AssetImage(_props: AssetImageProps): ReactElement {
  throw new Error('not implemented');
}
