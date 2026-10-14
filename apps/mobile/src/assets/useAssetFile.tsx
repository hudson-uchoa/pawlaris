import { createContext, type ReactNode } from 'react';
import type { AssetFileResult, AssetFiles } from './files';

export const AssetFilesContext = createContext<AssetFiles | null>(null);

export function AssetFilesProvider(props: { files: AssetFiles; children?: ReactNode }): ReactNode {
  return <AssetFilesContext.Provider value={props.files}>{props.children}</AssetFilesContext.Provider>;
}

export function useAssetFile(id: string): AssetFileResult {
  void id;
  throw new Error('not implemented');
}
