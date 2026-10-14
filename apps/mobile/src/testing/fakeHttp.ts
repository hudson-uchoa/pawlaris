import type { Http, HttpRequest, HttpResponse } from '../platform/http';

export type HttpReply = HttpResponse | Error
  | ((req: HttpRequest) => HttpResponse | Promise<HttpResponse>);

export interface FakeHttp extends Http {
  requests: HttpRequest[];
  enqueue(...replies: HttpReply[]): void;
}

export function fakeHttp(...initial: HttpReply[]): FakeHttp {
  const replies = [...initial];
  const requests: HttpRequest[] = [];
  return {
    requests,
    enqueue(...next) { replies.push(...next); },
    async request(req) {
      requests.push({ ...req, ...(req.headers === undefined ? {} : { headers: { ...req.headers } }) });
      const reply = replies.shift();
      if (reply === undefined) throw new Error('Fake HTTP has no queued response');
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(req) : reply;
    },
  };
}
