export interface Random {
  next(): number;
}

export const systemRandom: Random = {
  next(): number {
    throw new Error('Random.next is not implemented');
  },
};
