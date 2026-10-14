import type { SecretBox } from '../auth/secretBox';

export interface FakeSecretBox extends SecretBox {
  snapshot(): Readonly<Record<string, string>>;
}

export function fakeSecretBox(initial: Readonly<Record<string, string>> = {}): FakeSecretBox {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async del(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}
