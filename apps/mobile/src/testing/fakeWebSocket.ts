import type { SocketConnection } from '../sync/socket';

export function fakeWebSocket() {
  const instances: FakeWebSocket[] = [];

  class FakeWebSocket implements SocketConnection {
    onopen: OmitThisParameter<NonNullable<WebSocket['onopen']>> | null = null;
    onmessage: OmitThisParameter<NonNullable<WebSocket['onmessage']>> | null = null;
    onerror: OmitThisParameter<NonNullable<WebSocket['onerror']>> | null = null;
    onclose: OmitThisParameter<NonNullable<WebSocket['onclose']>> | null = null;
    readonly sent: string[] = [];
    readonly closes: { code: number; reason: string }[] = [];
    readyState = 0;

    constructor(readonly url: string) { instances.push(this); }

    open(): void {
      if (this.readyState !== 0) throw new Error('Fake socket is not connecting');
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }

    send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
      if (this.readyState !== 1) throw new Error('Fake socket is not open');
      if (typeof data !== 'string') throw new Error('Fake socket expects a text frame');
      this.sent.push(data);
    }

    receive(frame: unknown): void {
      if (this.readyState !== 1) throw new Error('Fake socket is not open');
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
    }

    serverClose(code = 1006): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.(Object.assign(new Event('close'), { code, reason: '', wasClean: code === 1000 }));
    }

    error(): void {
      this.onerror?.(Object.assign(new Event('error'), { message: 'simulated socket failure' }));
    }

    close(code = 1000, reason = ''): void {
      this.closes.push({ code, reason });
      this.serverClose(code);
    }
  }

  return { WebSocketImpl: FakeWebSocket, instances };
}
