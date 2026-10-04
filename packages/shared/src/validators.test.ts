import { describe, expect, it } from 'vitest';
import {
  validateHealthEvent, validatePassword, validatePet, validateTask, validateWeight,
  type FormValidationError,
} from './validators';

const petId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const stamp = '2026-10-04T12:00:00Z';
const pet = { name: 'Star', species: 'cat' };
const weight = { pet_id: petId, weight_kg: 4.25, measured_at: stamp };
const health = { pet_id: petId, type: 'vaccine', title: 'Booster', occurred_at: stamp };
const task = { title: 'Breakfast', recurrence: { freq: 'daily', interval: 1 }, starts_on: '2026-10-04', pet_ids: [petId] };
type Validator = (value: unknown) => FormValidationError[];

const forms: { name: string; validate: Validator; valid: Record<string, unknown>; required: string[] }[] = [
  { name: 'pet', validate: validatePet, valid: pet, required: ['name', 'species'] },
  { name: 'weight', validate: validateWeight, valid: weight, required: ['pet_id', 'weight_kg', 'measured_at'] },
  { name: 'health', validate: validateHealthEvent, valid: health, required: ['pet_id', 'type', 'title', 'occurred_at'] },
  { name: 'task', validate: validateTask, valid: task, required: ['title', 'recurrence', 'starts_on', 'pet_ids'] },
];

describe('form validators', () => {
  for (const form of forms) {
    it(`VL-1 ${form.name} accepts required fields and leaves input untouched`, () => {
      const input = structuredClone(form.valid);
      const before = structuredClone(input);
      expect(form.validate(input)).toEqual([]);
      expect(form.validate({ ...input, revision: 1 })).toEqual([]);
      expect(input).toEqual(before);
    });

    it.each(form.required)(`VL-2 ${form.name} requires %s`, (field) => {
      const input = { ...form.valid };
      delete input[field];
      expect(form.validate(input)).toContainEqual({ field: field === 'recurrence' ? 'freq' : field, code: 'required' });
    });

    const malformed = [null, undefined, [], 'text', 1].map((value, index) => ({ value, index }));
    it.each(malformed)(`VL-3 ${form.name} rejects malformed form $index`, ({ value }) => {
      expect(form.validate(value)).toEqual([{ field: 'form', code: 'invalid' }]);
    });
  }

  for (const { name, validate, valid, field, max } of [
    { name: 'pet', validate: validatePet, valid: pet, field: 'name', max: 40 },
    { name: 'health', validate: validateHealthEvent, valid: health, field: 'title', max: 80 },
    { name: 'task', validate: validateTask, valid: task, field: 'title', max: 80 },
  ]) {
    it(`VL-4 ${name} accepts text at both length edges and rejects one past`, () => {
      for (const length of [1, max]) expect(validate({ ...valid, [field]: 'x'.repeat(length) })).toEqual([]);
      for (const length of [0, max + 1]) {
        expect(validate({ ...valid, [field]: 'x'.repeat(length) })).toEqual([{ field, code: 'out_of_range' }]);
      }
      expect(validate({ ...valid, [field]: '😀'.repeat(max) })).toEqual([]);
      expect(validate({ ...valid, [field]: '😀'.repeat(max + 1) })).toEqual([{ field, code: 'out_of_range' }]);
      for (const value of [null, 1]) expect(validate({ ...valid, [field]: value })).toEqual([{ field, code: 'invalid' }]);
    });
  }

  it('VL-5 password accepts 8 and 128 characters and rejects 7 and 129', () => {
    for (const length of [8, 128]) expect(validatePassword('p'.repeat(length))).toEqual([]);
    for (const length of [0, 7, 129]) expect(validatePassword('p'.repeat(length)))
      .toEqual([{ field: 'password', code: 'out_of_range' }]);
    expect(validatePassword('😀'.repeat(8))).toEqual([]);
    expect(validatePassword('😀'.repeat(7))).toEqual([{ field: 'password', code: 'out_of_range' }]);
    expect(validatePassword(undefined)).toEqual([{ field: 'password', code: 'required' }]);
    for (const value of [null, 123, {}]) expect(validatePassword(value)).toEqual([{ field: 'password', code: 'invalid' }]);
  });

  it('VL-6 weight accepts the range edges and exactly two decimal places', () => {
    for (const value of [0.01, 119.99, 1, 4.25, 0.29]) expect(validateWeight({ ...weight, weight_kg: value })).toEqual([]);
    for (const value of [0, -0.01, 120, 0.009, 1.001]) expect(validateWeight({ ...weight, weight_kg: value }))
      .toEqual([{ field: 'weight_kg', code: 'out_of_range' }]);
    for (const value of [NaN, Infinity, -Infinity, null, '4.25']) expect(validateWeight({ ...weight, weight_kg: value }))
      .toEqual([{ field: 'weight_kg', code: 'invalid' }]);
  });

  it('VL-7 timer seconds accepts null and 1 to 86400 and rejects outside', () => {
    for (const timer_seconds of [null, 1, 86400]) expect(validateTask({ ...task, timer_seconds })).toEqual([]);
    for (const timer_seconds of [0, 86401]) expect(validateTask({ ...task, timer_seconds }))
      .toEqual([{ field: 'timer_seconds', code: 'out_of_range' }]);
    for (const timer_seconds of [1.5, '60', NaN]) expect(validateTask({ ...task, timer_seconds }))
      .toEqual([{ field: 'timer_seconds', code: 'invalid' }]);
  });

  it('VL-8 task requires at least one distinct UUID pet', () => {
    expect(validateTask({ ...task, pet_ids: [petId, otherId] })).toEqual([]);
    expect(validateTask({ ...task, pet_ids: [] })).toEqual([{ field: 'pet_ids', code: 'required' }]);
    expect(validateTask({ ...task, pet_ids: [petId, petId] })).toEqual([{ field: 'pet_ids', code: 'duplicate' }]);
    for (const pet_ids of [null, 'pet', [1], ['not-a-uuid']]) expect(validateTask({ ...task, pet_ids }))
      .toEqual([{ field: 'pet_ids', code: 'invalid' }]);
  });

  it('VL-9 task validates recurrence limits and once-date consistency', () => {
    for (const interval of [1, 365]) expect(validateTask({ ...task, recurrence: { freq: 'daily', interval } })).toEqual([]);
    for (const interval of [0, 366]) expect(validateTask({ ...task, recurrence: { freq: 'daily', interval } }))
      .toEqual([{ field: 'interval', code: 'out_of_range' }]);
    expect(validateTask({ ...task, recurrence: { freq: 'once', date: task.starts_on } })).toEqual([]);
    expect(validateTask({ ...task, recurrence: { freq: 'once', date: '2026-10-05' } }))
      .toEqual([{ field: 'date', code: 'mismatch' }]);
    expect(validateTask({ ...task, recurrence: { freq: 'daily', interval: 1, extra: 1 } }))
      .toEqual([{ field: 'extra', code: 'unknown_key' }]);
    expect(validateTask({ ...task, recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] } })).toEqual([]);
    expect(validateTask({ ...task, recurrence: { freq: 'weekly', interval: 1, byday: [] } }))
      .toEqual([{ field: 'byday', code: 'required' }]);
    expect(validateTask({ ...task, recurrence: { freq: 'weekly', interval: 1, byday: ['XX'] } }))
      .toEqual([{ field: 'byday', code: 'invalid' }]);
    expect(validateTask({ ...task, recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'MO'] } }))
      .toEqual([{ field: 'byday', code: 'duplicate' }]);
    expect(validateTask({ ...task, recurrence: { freq: 'monthly', interval: 1, bymonthday: Array.from({ length: 31 }, (_, i) => i + 1) } })).toEqual([]);
    expect(validateTask({ ...task, recurrence: { freq: 'monthly', interval: 1, bymonthday: [] } }))
      .toEqual([{ field: 'bymonthday', code: 'required' }]);
    for (const day of [0, 32]) expect(validateTask({ ...task, recurrence: { freq: 'monthly', interval: 1, bymonthday: [day] } }))
      .toEqual([{ field: 'bymonthday', code: 'out_of_range' }]);
  });

  it('VL-10 task accepts zero to eight sorted unique times in the HH:mm range', () => {
    for (const times_of_day of [[], ['00:00', '23:59'], Array.from({ length: 8 }, (_, i) => `0${i}:00`)])
      expect(validateTask({ ...task, times_of_day })).toEqual([]);
    expect(validateTask({ ...task, times_of_day: Array.from({ length: 9 }, (_, i) => `0${i}:00`) }))
      .toEqual([{ field: 'times_of_day', code: 'too_many' }]);
    for (const time of ['24:00', '8:00', '08:60', '08:00:30']) expect(validateTask({ ...task, times_of_day: [time] }))
      .toEqual([{ field: 'times_of_day', code: 'invalid' }]);
    expect(validateTask({ ...task, times_of_day: ['08:00', '08:00'] })).toEqual([{ field: 'times_of_day', code: 'duplicate' }]);
    expect(validateTask({ ...task, times_of_day: ['20:00', '08:00'] })).toEqual([{ field: 'times_of_day', code: 'unsorted' }]);
    expect(validateTask({ ...task, times_of_day: null })).toEqual([{ field: 'times_of_day', code: 'invalid' }]);
  });

  for (const { validate, valid, field, values } of [
    { validate: validatePet, valid: pet, field: 'species', values: ['cat', 'dog'] },
    { validate: validatePet, valid: pet, field: 'sex', values: ['female', 'male', 'unknown'] },
    { validate: validateHealthEvent, valid: health, field: 'type', values: ['vaccine', 'medication', 'vet_visit', 'symptom', 'procedure', 'other'] },
    { validate: validateTask, valid: task, field: 'category', values: ['feeding', 'medication', 'hygiene', 'litter', 'play', 'vet', 'other'] },
    { validate: validateTask, valid: task, field: 'completion_mode', values: ['together', 'per_pet'] },
    { validate: validateTask, valid: task, field: 'reminder_class', values: ['routine', 'critical'] },
  ]) {
    it(`VL-11 validates ${field} enum values`, () => {
      for (const value of values) expect(validate({ ...valid, [field]: value })).toEqual([]);
      for (const value of ['invalid', null, 1]) expect(validate({ ...valid, [field]: value }))
        .toEqual([{ field, code: 'invalid' }]);
    });
  }

  for (const { validate, valid, field, required } of [
    { validate: validatePet, valid: pet, field: 'birthdate', required: false },
    { validate: validateHealthEvent, valid: health, field: 'next_due_on', required: false },
    { validate: validateTask, valid: task, field: 'starts_on', required: true },
    { validate: validateTask, valid: task, field: 'ends_on', required: false },
  ]) {
    it(`VL-12 validates real calendar dates in ${field}`, () => {
      for (const value of ['0001-01-01', '9999-12-31', '2024-02-29']) {
        const input = { ...valid, [field]: value };
        expect(validate(input)).toEqual([]);
      }
      if (!required) expect(validate({ ...valid, [field]: null })).toEqual([]);
      for (const value of ['2026-02-29', '2026-04-31', '0000-01-01', '10000-01-01', '2026-1-01', 1]) {
        expect(validate({ ...valid, [field]: value })).toContainEqual({ field, code: 'invalid' });
      }
    });
  }

  for (const { validate, valid, field } of [
    { validate: validateWeight, valid: weight, field: 'measured_at' },
    { validate: validateHealthEvent, valid: health, field: 'occurred_at' },
  ]) {
    it(`VL-13 accepts UTC instants and rejects invalid timestamps in ${field}`, () => {
      for (const value of [stamp, '2024-02-29T23:59:59.123456Z', '2026-10-04T12:00:00+00:00'])
        expect(validate({ ...valid, [field]: value })).toEqual([]);
      for (const value of ['2026-02-29T12:00:00Z', '2026-10-04', '2026-10-04T24:00:00Z',
        '2026-10-04T12:60:00Z', '2026-10-04T12:00:60Z', '2026-10-04T12:00:00',
        '2026-10-04T12:00:00-03:00', null, 0]) expect(validate({ ...valid, [field]: value }))
        .toEqual([{ field, code: 'invalid' }]);
    });
  }

  for (const { validate, valid, fields } of [
    { validate: validatePet, valid: pet, fields: ['breed', 'color', 'microchip_id', 'notes'] },
    { validate: validateWeight, valid: weight, fields: ['note'] },
    { validate: validateHealthEvent, valid: health, fields: ['notes'] },
    { validate: validateTask, valid: task, fields: ['description'] },
  ]) {
    it.each(fields)('VL-14 validates optional nullable text %s without invented length limits', (field) => {
      for (const value of [null, '', 'x'.repeat(1000)]) expect(validate({ ...valid, [field]: value })).toEqual([]);
      expect(validate({ ...valid, [field]: 1 })).toEqual([{ field, code: 'invalid' }]);
    });
  }

  for (const { validate, valid, fields, nullable } of [
    { validate: validatePet, valid: pet, fields: ['avatar_asset_id'], nullable: true },
    { validate: validateHealthEvent, valid: health, fields: ['attachment_asset_id'], nullable: true },
    { validate: validateTask, valid: task, fields: ['assigned_to', 'replaces_task_id'], nullable: true },
    { validate: validateWeight, valid: weight, fields: ['pet_id'], nullable: false },
    { validate: validateHealthEvent, valid: health, fields: ['pet_id'], nullable: false },
  ]) {
    it.each(fields)('VL-15 validates UUID reference %s', (field) => {
      expect(validate({ ...valid, [field]: petId })).toEqual([]);
      if (nullable) expect(validate({ ...valid, [field]: null })).toEqual([]);
      for (const value of ['', 'pet', 1]) expect(validate({ ...valid, [field]: value })).toEqual([{ field, code: 'invalid' }]);
    });
  }

  it('VL-16 validates integer sort orders at PostgreSQL bounds', () => {
    for (const [validate, valid] of [[validatePet, pet], [validateTask, task]] as const) {
      for (const sort_order of [-2147483648, 0, 2147483647]) expect(validate({ ...valid, sort_order })).toEqual([]);
      for (const sort_order of [-2147483649, 2147483648]) expect(validate({ ...valid, sort_order }))
        .toEqual([{ field: 'sort_order', code: 'out_of_range' }]);
      for (const sort_order of [1.5, null, '0']) expect(validate({ ...valid, sort_order }))
        .toEqual([{ field: 'sort_order', code: 'invalid' }]);
    }
  });

  it('VL-17 validates photo boolean and permits an end date before start', () => {
    for (const requires_photo of [false, true]) expect(validateTask({ ...task, requires_photo })).toEqual([]);
    for (const requires_photo of [null, 'false', 0]) expect(validateTask({ ...task, requires_photo }))
      .toEqual([{ field: 'requires_photo', code: 'invalid' }]);
    expect(validateTask({ ...task, ends_on: '2026-10-03' })).toEqual([]);
  });

  it('VL-18 returns all field errors with stable codes and does not mutate failures', () => {
    const input = { ...pet, name: '', species: 'bird', birthdate: '2026-02-29' };
    const before = structuredClone(input);
    expect(validatePet(input)).toEqual([
      { field: 'name', code: 'out_of_range' }, { field: 'species', code: 'invalid' },
      { field: 'birthdate', code: 'invalid' },
    ]);
    expect(input).toEqual(before);
  });
});
