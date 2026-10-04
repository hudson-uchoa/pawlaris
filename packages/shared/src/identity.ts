export const IDENTITY_KEYS = [
  '#5B7DB1', '#B15B6B', '#4F8A6B', '#C88A2E', '#7A65B0', '#3F8F97', '#B5654A', '#B15B9E',
] as const;

export function identityIndexForKey(key: string): number {
  const index = IDENTITY_KEYS.findIndex((entry) => entry === key);
  return index < 0 ? 0 : index;
}

export function identityIndexForId(id: string): number {
  let sum = 0;
  for (let index = 0; index < id.length; index += 1) sum += id.charCodeAt(index);
  return sum % IDENTITY_KEYS.length;
}
