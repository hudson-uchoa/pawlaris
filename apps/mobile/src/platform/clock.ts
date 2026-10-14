export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now(): number {
    throw new Error('Clock.now is not implemented');
  },
};
