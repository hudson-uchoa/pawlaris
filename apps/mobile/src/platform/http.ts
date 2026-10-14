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
  async request(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 15_000);
    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: {
          ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...req.headers,
        },
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      const text = await response.text();
      let body: unknown = null;
      if (text !== '') {
        try { body = JSON.parse(text) as unknown; }
        catch { body = text; }
      }
      return { status: response.status, body, headers };
    } finally {
      clearTimeout(timeout);
    }
  },
};
