import { randomUUID } from 'expo-crypto';

export interface IdGen {
  uuid(): string;
}

export const cryptoIds: IdGen = {
  uuid(): string {
    return randomUUID();
  },
};
