import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useReplica } from '../replica/useReplica';
import type { AssetFileResult, AssetFiles } from './files';

export const AssetFilesContext = createContext<AssetFiles | null>(null);

export function AssetFilesProvider(props: { files: AssetFiles; children?: ReactNode }): ReactNode {
  return <AssetFilesContext.Provider value={props.files}>{props.children}</AssetFilesContext.Provider>;
}

export function useAssetFile(id: string): AssetFileResult {
  const files = useContext(AssetFilesContext);
  if (files === null) throw new Error('useAssetFile requires an AssetFilesProvider');
  const assets = useReplica((state) => state.assets);
  const [loaded, setLoaded] = useState<{ id: string; value: AssetFileResult }>({
    id, value: { status: 'pending' },
  });
  useEffect(() => {
    let active = true;
    void files.ensureFile(id).then((value) => {
      if (active) setLoaded({ id, value });
    });
    return () => { active = false; };
  }, [files, id, assets]);
  return loaded.id === id ? loaded.value : { status: 'pending' };
}
