export interface Servers {
  primary: string;
  reserve?: string;
}

export function readServers(): Servers {
  const primary = process.env.EXPO_PUBLIC_API_URL;
  const reserve = process.env.EXPO_PUBLIC_RESERVE_API_URL;
  if (!primary) throw new Error('EXPO_PUBLIC_API_URL is required');
  return { primary, ...(reserve ? { reserve } : {}) };
}
