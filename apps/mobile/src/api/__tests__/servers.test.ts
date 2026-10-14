import { activeServer, readServers } from '../../config/servers';

const originalPrimary = process.env.EXPO_PUBLIC_API_URL;
const originalReserve = process.env.EXPO_PUBLIC_RESERVE_API_URL;

afterEach(() => {
  if (originalPrimary === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = originalPrimary;
  if (originalReserve === undefined) delete process.env.EXPO_PUBLIC_RESERVE_API_URL;
  else process.env.EXPO_PUBLIC_RESERVE_API_URL = originalReserve;
});

test('API-CONFIG-ONE: read the build-time primary address without a reserve', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://primary.pawlaris.invalid/api/v1';
  delete process.env.EXPO_PUBLIC_RESERVE_API_URL;
  expect(readServers()).toEqual({ primary: 'https://primary.pawlaris.invalid/api/v1' });
});

test('API-CONFIG-TWO: read both build-time addresses', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://primary.pawlaris.invalid/api/v1';
  process.env.EXPO_PUBLIC_RESERVE_API_URL = 'https://reserve.pawlaris.invalid/api/v1';
  expect(readServers()).toEqual({
    primary: 'https://primary.pawlaris.invalid/api/v1',
    reserve: 'https://reserve.pawlaris.invalid/api/v1',
  });
});

test('API-CONFIG-ACTIVE: the production selector stays primary until P3-9', () => {
  expect(activeServer()).toBe('primary');
});
