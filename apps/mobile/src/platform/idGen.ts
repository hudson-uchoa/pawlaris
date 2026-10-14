export interface IdGen {
  uuid(): string;
}

export const cryptoIds: IdGen = {
  uuid(): string {
    throw new Error('IdGen.uuid is not implemented');
  },
};
