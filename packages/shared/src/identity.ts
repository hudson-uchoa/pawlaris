export const IDENTITY_KEYS = [
  '#5B7DB1', '#B15B6B', '#4F8A6B', '#C88A2E', '#7A65B0', '#3F8F97', '#B5654A', '#B15B9E',
] as const;

export function identityIndexForKey(_key: string): number {
  void _key;
  throw new Error('not implemented');
}

export function identityIndexForId(_id: string): number {
  void _id;
  throw new Error('not implemented');
}
