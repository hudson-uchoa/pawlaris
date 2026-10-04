import { isDateKey } from './dates';
import { validateRecurrence, validateTimesOfDay } from './recurrence';

export type FormValidationError = {
  field: string;
  code: 'required' | 'invalid' | 'out_of_range' | 'duplicate' | 'unsorted'
    | 'too_many' | 'mismatch' | 'unknown_key';
};

type Form = Record<string, unknown>;
type Check = (value: unknown) => FormValidationError['code'] | null;

// Q-12: form values use row field names; generated fields are outside this check.
function formObject(value: unknown): Form | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Form : null;
}

function field(errors: FormValidationError[], form: Form, name: string, check: Check,
  required = false, nullable = false): void {
  const value = form[name];
  if (value === undefined) {
    if (required) errors.push({ field: name, code: 'required' });
    return;
  }
  if (value === null && nullable) return;
  const code = check(value);
  if (code !== null) errors.push({ field: name, code });
}

function text(value: unknown): FormValidationError['code'] | null {
  return typeof value === 'string' ? null : 'invalid';
}

function boundedText(min: number, max: number): Check {
  return (value) => {
    if (typeof value !== 'string') return 'invalid';
    // PostgreSQL length counts characters, not UTF-16 code units.
    const length = [...value].length;
    return length < min || length > max ? 'out_of_range' : null;
  };
}

function enumValue(values: readonly string[]): Check {
  return (value) => typeof value === 'string' && values.includes(value) ? null : 'invalid';
}

function date(value: unknown): FormValidationError['code'] | null {
  return typeof value === 'string' && isDateKey(value) ? null : 'invalid';
}

function uuid(value: unknown): FormValidationError['code'] | null {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
    && value.length === 36 ? null : 'invalid';
}

function instant(value: unknown): FormValidationError['code'] | null {
  if (typeof value !== 'string') return 'invalid';
  // Q-12: real UTC timestamps only; do not let Date.parse normalize a date.
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|\+00:00)$/.exec(value);
  return match !== null && match[0] === value && match[1] !== undefined && isDateKey(match[1]) ? null : 'invalid';
}

function integer(min: number, max: number): Check {
  return (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid';
    return value < min || value > max ? 'out_of_range' : null;
  };
}

const sortOrder = integer(-2147483648, 2147483647);

export function validatePet(value: unknown): FormValidationError[] {
  const form = formObject(value);
  if (form === null) return [{ field: 'form', code: 'invalid' }];
  const errors: FormValidationError[] = [];
  field(errors, form, 'name', boundedText(1, 40), true);
  field(errors, form, 'species', enumValue(['cat', 'dog']), true);
  field(errors, form, 'sex', enumValue(['female', 'male', 'unknown']));
  for (const name of ['breed', 'color', 'microchip_id', 'notes']) field(errors, form, name, text, false, true);
  field(errors, form, 'birthdate', date, false, true);
  field(errors, form, 'avatar_asset_id', uuid, false, true);
  field(errors, form, 'sort_order', sortOrder);
  return errors;
}

export function validateWeight(value: unknown): FormValidationError[] {
  const form = formObject(value);
  if (form === null) return [{ field: 'form', code: 'invalid' }];
  const errors: FormValidationError[] = [];
  field(errors, form, 'pet_id', uuid, true);
  field(errors, form, 'weight_kg', (weight) => {
    if (typeof weight !== 'number' || !Number.isFinite(weight)) return 'invalid';
    const cents = weight * 100;
    const hasDecimals = Math.abs(cents - Math.round(cents)) > Number.EPSILON * Math.abs(cents);
    return weight < 0.01 || weight > 119.99 || hasDecimals ? 'out_of_range' : null;
  }, true);
  field(errors, form, 'measured_at', instant, true);
  field(errors, form, 'note', text, false, true);
  return errors;
}

export function validateHealthEvent(value: unknown): FormValidationError[] {
  const form = formObject(value);
  if (form === null) return [{ field: 'form', code: 'invalid' }];
  const errors: FormValidationError[] = [];
  field(errors, form, 'pet_id', uuid, true);
  field(errors, form, 'type', enumValue(['vaccine', 'medication', 'vet_visit', 'symptom', 'procedure', 'other']), true);
  field(errors, form, 'title', boundedText(1, 80), true);
  field(errors, form, 'occurred_at', instant, true);
  field(errors, form, 'notes', text, false, true);
  field(errors, form, 'next_due_on', date, false, true);
  field(errors, form, 'attachment_asset_id', uuid, false, true);
  return errors;
}

export function validateTask(value: unknown): FormValidationError[] {
  const form = formObject(value);
  if (form === null) return [{ field: 'form', code: 'invalid' }];
  const errors: FormValidationError[] = [];
  field(errors, form, 'title', boundedText(1, 80), true);
  field(errors, form, 'description', text, false, true);
  field(errors, form, 'category', enumValue(['feeding', 'medication', 'hygiene', 'litter', 'play', 'vet', 'other']));
  field(errors, form, 'assigned_to', uuid, false, true);
  field(errors, form, 'requires_photo', (value) => typeof value === 'boolean' ? null : 'invalid');
  field(errors, form, 'timer_seconds', integer(1, 86400), false, true);
  field(errors, form, 'reminder_class', enumValue(['routine', 'critical']));
  field(errors, form, 'sort_order', sortOrder);
  field(errors, form, 'starts_on', date, true);
  const startsOn = typeof form.starts_on === 'string' ? form.starts_on : '';
  const recurrence = validateRecurrence(form.recurrence, startsOn);
  if (!recurrence.ok) {
    errors.push(...recurrence.errors.filter((error) => error.field !== 'starts_on' || error.code !== 'invalid'));
  }
  if (form.times_of_day !== undefined) {
    const times = validateTimesOfDay(form.times_of_day);
    if (!times.ok) errors.push(...times.errors);
  }
  if (form.pet_ids === undefined) errors.push({ field: 'pet_ids', code: 'required' });
  else if (!Array.isArray(form.pet_ids) || !form.pet_ids.every((id: unknown): id is string => uuid(id) === null)) {
    errors.push({ field: 'pet_ids', code: 'invalid' });
  } else {
    if (form.pet_ids.length === 0) errors.push({ field: 'pet_ids', code: 'required' });
    if (new Set(form.pet_ids.map((id) => id.toLowerCase())).size !== form.pet_ids.length) {
      errors.push({ field: 'pet_ids', code: 'duplicate' });
    }
  }
  field(errors, form, 'completion_mode', enumValue(['together', 'per_pet']));
  field(errors, form, 'ends_on', date, false, true);
  field(errors, form, 'replaces_task_id', uuid, false, true);
  return errors;
}

export function validatePassword(value: unknown): FormValidationError[] {
  const errors: FormValidationError[] = [];
  field(errors, { password: value }, 'password', boundedText(8, 128), true);
  return errors;
}
