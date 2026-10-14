export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type HttpHeaders = Readonly<Record<string, string>>;

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  body?: unknown;
  headers?: HttpHeaders;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers: HttpHeaders;
}

export interface Http {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export const fetchHttp: Http = {
  async request(_req: HttpRequest): Promise<HttpResponse> {
    throw new Error('Http.request is not implemented');
  },
};
