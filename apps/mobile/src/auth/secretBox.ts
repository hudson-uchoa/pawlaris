export interface SecretBox {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  del(k: string): Promise<void>;
}

export function expoSecretBox(): SecretBox {
  throw new Error('expoSecretBox is not implemented');
}
