import type { FileSystem } from './fileSystem';

export const expoFileSystem: FileSystem = {
  async exists(uri) {
    void uri;
    throw new Error('not implemented');
  },
  async download(url, uri, headers) {
    void url; void uri; void headers;
    throw new Error('not implemented');
  },
  async upload(url, uri, headers) {
    void url; void uri; void headers;
    throw new Error('not implemented');
  },
  async remove(uri) {
    void uri;
    throw new Error('not implemented');
  },
};
