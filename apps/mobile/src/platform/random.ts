export interface Random {
  next(): number;
}

export const systemRandom: Random = {
  next(): number {
    return Math.random();
  },
};
