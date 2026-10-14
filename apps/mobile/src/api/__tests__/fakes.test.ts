import { fakeClock } from '../../testing/fakeClock';
import { fakeHttp } from '../../testing/fakeHttp';
import { fakeRandom } from '../../testing/fakeRandom';
import { fakeSecretBox } from '../../testing/fakeSecretBox';

test('FAKE-HTTP: record requests and consume queued replies in order', async () => {
  const first = { status: 200, body: { id: 'fake-first' }, headers: {} };
  const second = { status: 204, body: null, headers: {} };
  const http = fakeHttp(first);
  http.enqueue(second);
  const req = { method: 'GET' as const, url: 'https://test.pawlaris.invalid/api/v1/me' };
  expect(await http.request(req)).toEqual(first);
  expect(await http.request(req)).toEqual(second);
  expect(http.requests).toEqual([req, req]);
  await expect(http.request(req)).rejects.toThrow('Fake HTTP has no queued response');
});

test('FAKE-HTTP-FAILURE: throw scripted errors and await scripted responses', async () => {
  const failure = new Error('Fake transport failure');
  const clock = fakeClock(0);
  const http = fakeHttp(failure, async (req) => {
    clock.advance(15_000);
    return { status: 200, body: req.body, headers: {} };
  });
  const req = { method: 'POST' as const, url: 'https://test.pawlaris.invalid/api/v1/pets', body: null };
  await expect(http.request(req)).rejects.toBe(failure);
  expect(await http.request(req)).toEqual({ status: 200, body: null, headers: {} });
  expect(clock.now()).toBe(15_000);
});

test('FAKE-RANDOM: yield the supplied deterministic values without a global source', () => {
  const random = fakeRandom(0, 0.5, 0.999);
  expect([random.next(), random.next(), random.next()]).toEqual([0, 0.5, 0.999]);
  expect(() => random.next()).toThrow('Fake random has no queued value');
});

test.each([-1, 1, NaN, Infinity])('FAKE-RANDOM-RANGE: reject %s outside [0, 1)', (value) => {
  expect(() => fakeRandom(value).next()).toThrow('Fake random value must be in [0, 1)');
});

test('FAKE-SECRETS: retain values across consumers and expose an independent snapshot', async () => {
  const box = fakeSecretBox({ initial: 'fake-initial-secret' });
  const before = box.snapshot();
  expect(await box.get('missing')).toBeNull();
  expect(await box.get('initial')).toBe('fake-initial-secret');
  await box.set('initial', 'fake-replaced-secret');
  await box.set('second', 'fake-second-secret');
  expect(await box.get('initial')).toBe('fake-replaced-secret');
  await box.del('second');
  await box.del('missing');
  expect(await box.get('second')).toBeNull();
  expect(before).toEqual({ initial: 'fake-initial-secret' });
  expect(box.snapshot()).toEqual({ initial: 'fake-replaced-secret' });
});
