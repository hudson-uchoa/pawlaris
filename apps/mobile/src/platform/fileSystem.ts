import type { HttpHeaders, HttpResponse } from './http';

export type HttpResult = HttpResponse;

export interface FileSystem {
  exists(uri: string): Promise<boolean>;
  download(url: string, uri: string, headers: HttpHeaders): Promise<HttpResult>;
  upload(url: string, uri: string, headers: HttpHeaders): Promise<HttpResult>;
  remove(uri: string): Promise<void>;
}
