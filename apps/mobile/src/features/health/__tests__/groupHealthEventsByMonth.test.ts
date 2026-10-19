import { fakeClock } from '../../../testing/fakeClock';
import { rowFactories } from '../../../testing/rowFactories';
import { sequentialIds } from '../../../testing/sequentialIds';
import { groupHealthEventsByMonth } from '../groupHealthEventsByMonth';

const factory = rowFactories(fakeClock(0), sequentialIds());

test('R2.12 groups at family-local month and year boundaries, newest first', () => {
  const december = factory.health_events({ occurred_at: '2027-01-01T02:59:00.000Z' });
  const january = factory.health_events({ occurred_at: '2027-01-01T03:00:00.000Z' });
  const november = factory.health_events({ occurred_at: '2026-12-01T02:59:00.000Z' });
  const earlyDecember = factory.health_events({ occurred_at: '2026-12-01T03:00:00.000Z' });
  const events = [earlyDecember, november, january, december];
  const original = [...events];
  expect(groupHealthEventsByMonth(events, 'America/Sao_Paulo')).toEqual([
    { month: '2027-01', events: [january] },
    { month: '2026-12', events: [december, earlyDecember] },
    { month: '2026-11', events: [november] },
  ]);
  expect(events).toEqual(original);
});

test('R2.12 uses the supplied family timezone for an eastward month boundary', () => {
  const february = factory.health_events({ occurred_at: '2026-01-31T15:00:00.000Z' });
  const january = factory.health_events({ occurred_at: '2026-01-31T14:59:00.000Z' });
  expect(groupHealthEventsByMonth([january, february], 'Asia/Tokyo')).toEqual([
    { month: '2026-02', events: [february] },
    { month: '2026-01', events: [january] },
  ]);
});
