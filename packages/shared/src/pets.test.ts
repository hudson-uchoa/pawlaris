import { describe, expect, it } from 'vitest';
import type { HealthEvent, Pet } from './entities';
import { needsWeightConfirmation, petAge, upcomingCare } from './pets';

const today = '2026-10-04';
const stamp = '2026-10-04T12:00:00Z';

function pet(patch: Partial<Pet> = {}): Pet {
  return {
    id: 'pet', name: 'Star', species: 'cat', sex: 'unknown', breed: null,
    color: null, birthdate: null, microchip_id: null, avatar_asset_id: null,
    notes: null, sort_order: 0, archived_at: null, created_by: 'me',
    revision: 1, updated_at: stamp, deleted_at: null, ...patch,
  };
}

function event(patch: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: 'event', pet_id: 'pet', type: 'vaccine', title: 'Booster', notes: null,
    occurred_at: stamp, next_due_on: today, attachment_asset_id: null,
    created_by: 'me', revision: 1, updated_at: stamp, deleted_at: null, ...patch,
  };
}

describe('pet age', () => {
  it.each([
    ['PA-1', '2026-10-04', today, { years: 0, months: 0, days: 0 }],
    ['PA-2', '2026-09-22', today, { years: 0, months: 0, days: 12 }],
    ['PA-3', '2025-06-04', today, { years: 1, months: 4, days: 0 }],
    ['PA-4', '2023-10-04', today, { years: 3, months: 0, days: 0 }],
    ['PA-5', '2024-02-28', '2024-03-01', { years: 0, months: 0, days: 2 }],
    ['PA-6', '2024-02-29', '2025-02-28', { years: 1, months: 0, days: 0 }],
    ['PA-7', '2024-02-29', '2025-02-27', { years: 0, months: 11, days: 29 }],
    ['PA-8', '2024-02-29', '2028-02-29', { years: 4, months: 0, days: 0 }],
    ['PA-9', '2026-01-31', '2026-03-01', { years: 0, months: 1, days: 1 }],
    ['PA-10', '2025-12-31', '2026-01-30', { years: 0, months: 0, days: 30 }],
    ['PA-11', '0001-01-01', '0001-02-01', { years: 0, months: 1, days: 0 }],
  ] as const)('%s decomposes calendar age from %s to %s', (_code, birthdate, date, expected) => {
    expect(petAge(birthdate, date)).toEqual(expected);
  });

  it('PA-12 rejects invalid and future birthdates', () => {
    for (const [birthdate, date] of [['2026-02-29', today], [today, 'invalid'], ['2026-10-05', today]]) {
      if (birthdate === undefined || date === undefined) throw new Error('Expected two dates');
      expect(() => petAge(birthdate, date)).toThrow(RangeError);
    }
  });
});

describe('weight confirmation', () => {
  it.each([
    ['WG-1', null, 12, false], ['WG-2', 10, 10, false],
    ['WG-3', 10, 12, false], ['WG-4', 10, 8, false],
    ['WG-5', 100, 120.01, true], ['WG-6', 100, 79.99, true],
    ['WG-7', 0.05, 0.06, false], ['WG-8', 0.05, 0.04, false],
    ['WG-9', 2, 12, true], ['WG-10', 12, 2, true],
  ] as const)('%s confirms only a change greater than twenty percent', (_code, prev, next, expected) => {
    expect(needsWeightConfirmation(prev, next)).toBe(expected);
  });
});

describe('upcoming care', () => {
  it('UC-1 includes overdue, today and seven days ahead but excludes eight', () => {
    const healthEvents = [
      event({ id: 'seven', next_due_on: '2026-10-11' }),
      event({ id: 'eight', next_due_on: '2026-10-12' }),
      event({ id: 'today' }), event({ id: 'overdue', next_due_on: '2026-10-02' }),
    ];
    expect(upcomingCare({ healthEvents, pets: [pet()], today })).toEqual([
      { ...healthEvents[3], daysUntil: -2 }, { ...healthEvents[2], daysUntil: 0 },
      { ...healthEvents[0], daysUntil: 7 },
    ]);
    expect(upcomingCare({ healthEvents: [event({ next_due_on: '2020-01-01' })], pets: [pet()], today }))
      .toHaveLength(1);
  });

  it('UC-2 removes events when edited, deleted or without a due date', () => {
    const healthEvents = [event({ next_due_on: null }), event({ deleted_at: stamp }),
      event({ next_due_on: '2026-10-12' })];
    expect(upcomingCare({ healthEvents, pets: [pet()], today })).toEqual([]);
  });

  it('UC-3 excludes archived, soft-deleted and absent pets', () => {
    for (const pets of [[pet({ archived_at: stamp })], [pet({ deleted_at: stamp })], [], [pet({ id: 'other' })]]) {
      expect(upcomingCare({ healthEvents: [event()], pets, today })).toEqual([]);
    }
    expect(upcomingCare({ healthEvents: [event()], pets: [pet()], today })).toHaveLength(1);
  });

  it('UC-4 sorts equal due dates by event id without mutating inputs', () => {
    const input = { healthEvents: [event({ id: 'b' }), event({ id: 'a' })], pets: [pet()], today };
    const before = structuredClone(input);
    const result = upcomingCare(input);
    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
    expect(input).toEqual(before);
    const first = result[0];
    if (first === undefined) throw new Error('Expected a care item');
    first.title = 'Changed';
    expect(input).toEqual(before);
    expect(upcomingCare({ healthEvents: [], pets: [], today })).toEqual([]);
  });
});
