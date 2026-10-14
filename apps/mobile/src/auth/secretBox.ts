import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

export interface SecretBox {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  del(k: string): Promise<void>;
}

export function expoSecretBox(): SecretBox {
  return { get: getItemAsync, set: setItemAsync, del: deleteItemAsync };
}
