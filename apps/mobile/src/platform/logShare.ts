import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { LogShare } from '../features/settings/types';

export function createExpoLogShare(): LogShare {
  return {
    async shareText(filename, text) {
      if (!FileSystem.cacheDirectory) throw new Error('The cache directory is unavailable');
      const directory = `${FileSystem.cacheDirectory}diagnostics/`;
      const uri = `${directory}${filename}`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      try {
        await FileSystem.writeAsStringAsync(uri, text, { encoding: 'utf8' });
        await Sharing.shareAsync(uri, { mimeType: 'text/plain', UTI: 'public.plain-text' });
      } finally {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    },
  };
}
