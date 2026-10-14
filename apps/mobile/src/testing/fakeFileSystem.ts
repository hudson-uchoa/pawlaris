import type { FileSystem, HttpResult } from '../platform/fileSystem';
import type { HttpHeaders } from '../platform/http';

export interface FileTransfer {
  method: 'GET' | 'PUT';
  url: string;
  uri: string;
  headers: HttpHeaders;
}

export type FileReply = HttpResult | Error
  | ((request: FileTransfer) => HttpResult | Promise<HttpResult>);

export interface FakeFileSystem extends FileSystem {
  readonly requests: FileTransfer[];
  readonly removed: string[];
  write(uri: string, bytes: Uint8Array): void;
  read(uri: string): Uint8Array | null;
  enqueue(...replies: FileReply[]): void;
}

export function fakeFileSystem(...initial: FileReply[]): FakeFileSystem {
  const files = new Map<string, Uint8Array>();
  const replies = [...initial];
  const requests: FileTransfer[] = [];
  const removed: string[] = [];

  const transfer = async (request: FileTransfer): Promise<HttpResult> => {
    requests.push({ ...request, headers: { ...request.headers } });
    const reply = replies.shift();
    if (reply === undefined) throw new Error('Fake file system has no queued response');
    if (reply instanceof Error) throw reply;
    const result = typeof reply === 'function' ? await reply(request) : reply;
    if (request.method === 'GET' && result.status >= 200 && result.status < 300) {
      files.set(request.uri, result.body instanceof Uint8Array ? result.body.slice() : new Uint8Array());
    }
    return result;
  };

  return {
    requests, removed,
    enqueue(...next) { replies.push(...next); },
    write(uri, bytes) { files.set(uri, bytes.slice()); },
    read(uri) { return files.get(uri)?.slice() ?? null; },
    async exists(uri) { return files.has(uri); },
    async download(url, uri, headers) { return transfer({ method: 'GET', url, uri, headers }); },
    async upload(url, uri, headers) {
      const bytes = files.get(uri);
      if (bytes === undefined) throw new Error('Fake upload file does not exist');
      return transfer({ method: 'PUT', url, uri,
        headers: { ...headers, 'Content-Length': String(bytes.byteLength) } });
    },
    async remove(uri) { removed.push(uri); files.delete(uri); },
  };
}
