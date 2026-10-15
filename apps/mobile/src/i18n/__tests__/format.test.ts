import {
  validateHealthEvent, validatePassword, validatePet, validateTask, validateWeight,
  type FormValidationError,
} from '@pawlaris/shared';
import {
  formatCompletionLost, formatDayLabel, formatDecimal, formatDistance, formatDuration,
  formatPace, formatPetAge, formatScheduleSummary, formatShortDate, formatTime,
  formatValidationError, type ScheduleSummaryInput,
} from '../format';
import { strings } from '../strings';

const timezone = 'America/Sao_Paulo';
const instant = Date.parse('2026-10-03T10:12:00Z');

describe('P4-1 copy: every formatting row of 09 section 10', () => {
  test('time uses family-local HH:mm', () => {
    expect(formatTime(instant, timezone)).toBe('07:12');
    expect(formatTime(instant, 'UTC')).toBe('10:12');
  });

  test('short date uses dd/MM', () => {
    expect(formatShortDate('2026-10-03')).toBe('03/10');
  });

  test('day label uses weekday and month abbreviations', () => {
    expect(formatDayLabel('2026-10-03')).toBe('sáb., 3 de out.');
    expect(formatDayLabel('2026-10-14')).toBe('qua., 14 de out.');
  });

  test('decimal uses a comma and retains the requested precision', () => {
    expect(`${formatDecimal(4.25, 2)} kg`).toBe('4,25 kg');
    expect(`${formatDecimal(2.14, 2)} km`).toBe('2,14 km');
    expect(formatDecimal(2, 2)).toBe('2,00');
  });

  test.each([
    [850, '850 m'], [999, '999 m'], [1000, '1,00 km'], [2140, '2,14 km'],
  ] as const)('distance %s m formats as %s', (metres, expected) => {
    expect(formatDistance(metres)).toBe(expected);
  });

  test.each([
    [1812, '30:12'], [3912, '1:05:12'], [3599, '59:59'], [3600, '1:00:00'],
  ] as const)('duration %s seconds formats as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  test('pace uses mm:ss /km and an unavailable pace uses the R4.12 marker', () => {
    expect(formatPace(855)).toBe('14:15 /km');
    expect(formatPace(null)).toBe('--');
  });

  test.each([
    ['2023-10-15', '3 anos'],
    ['2025-06-15', '1 ano e 4 meses'],
    ['2026-05-15', '5 meses'],
    ['2026-10-03', '12 dias'],
  ] as const)('R2.4 age from %s on the injected date formats as %s', (birthdate, expected) => {
    expect(formatPetAge(birthdate, '2026-10-15')).toBe(expected);
  });
});

describe('P4-1 schedule summaries: the four examples of 09 section 5.2', () => {
  const cases: readonly { input: ScheduleSummaryInput; expected: string }[] = [
    { input: { recurrence: { freq: 'daily', interval: 1 }, timesOfDay: ['08:00', '20:00'] }, expected: 'Todo dia · 08:00, 20:00' },
    { input: { recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'WE', 'FR'] }, timesOfDay: ['07:00'] }, expected: 'Seg, qua, sex · 07:00' },
    { input: { recurrence: { freq: 'monthly', interval: 1, bymonthday: [1, 15] }, timesOfDay: [] }, expected: 'Dias 1 e 15 · o dia todo' },
    { input: { recurrence: { freq: 'once', date: '2026-10-03' }, timesOfDay: [] }, expected: 'Uma vez · 03/10' },
  ];
  test.each(cases)('$expected', ({ input, expected }) => {
    expect(formatScheduleSummary(input)).toBe(expected);
  });
});

describe('P4-1 Q-34 schedule summaries: the four additional examples', () => {
  const cases: readonly { input: ScheduleSummaryInput; expected: string }[] = [
    { input: { recurrence: { freq: 'daily', interval: 2 }, timesOfDay: ['08:00'] }, expected: 'A cada 2 dias · 08:00' },
    { input: { recurrence: { freq: 'weekly', interval: 2, byday: ['TH', 'MO'] }, timesOfDay: [] }, expected: 'A cada 2 semanas · Seg, qui · o dia todo' },
    { input: { recurrence: { freq: 'monthly', interval: 3, bymonthday: [10] }, timesOfDay: ['09:00'] }, expected: 'A cada 3 meses · Dia 10 · 09:00' },
    { input: { recurrence: { freq: 'once', date: '2026-10-03' }, timesOfDay: ['18:30'] }, expected: 'Uma vez · 03/10 · 18:30' },
  ];
  test.each(cases)('$expected', ({ input, expected }) => {
    expect(formatScheduleSummary(input)).toBe(expected);
  });
});

describe('P4-1 validation copy: every row of 09 section 10, first match wins', () => {
  const cases: readonly { field: string; code: FormValidationError['code']; message: string }[] = [
    { field: 'name', code: 'required', message: 'Informe o nome.' },
    { field: 'name', code: 'out_of_range', message: 'O nome pode ter até 40 caracteres.' },
    { field: 'title', code: 'required', message: 'Informe o título.' },
    { field: 'title', code: 'out_of_range', message: 'O título pode ter até 80 caracteres.' },
    { field: 'species', code: 'required', message: 'Escolha a espécie.' },
    { field: 'type', code: 'required', message: 'Escolha o tipo.' },
    { field: 'weight_kg', code: 'required', message: 'Informe o peso.' },
    { field: 'weight_kg', code: 'invalid', message: 'Informe o peso em kg, como 4,25.' },
    { field: 'weight_kg', code: 'out_of_range', message: 'O peso vai de 0,01 a 119,99 kg, com até duas casas decimais.' },
    { field: 'measured_at', code: 'required', message: 'Informe a data.' },
    { field: 'occurred_at', code: 'required', message: 'Informe a data.' },
    { field: 'starts_on', code: 'required', message: 'Informe a data.' },
    { field: 'date', code: 'required', message: 'Informe a data.' },
    { field: 'password', code: 'required', message: 'Informe a senha.' },
    { field: 'password', code: 'out_of_range', message: 'A senha precisa ter de 8 a 128 caracteres.' },
    { field: 'pet_ids', code: 'required', message: 'Escolha pelo menos um pet.' },
    { field: 'byday', code: 'required', message: 'Escolha pelo menos um dia da semana.' },
    { field: 'bymonthday', code: 'required', message: 'Escolha pelo menos um dia do mês.' },
    { field: 'interval', code: 'out_of_range', message: 'O intervalo vai de 1 a 365.' },
    { field: 'times_of_day', code: 'too_many', message: 'São no máximo 8 horários.' },
    { field: 'times_of_day', code: 'duplicate', message: 'Esse horário já está na lista.' },
    { field: 'timer_seconds', code: 'out_of_range', message: 'O cronômetro vai de 1 a 1440 minutos.' },
  ];

  test.each(cases)('$field / $code', ({ field, code, message }) => {
    expect(formatValidationError({ field, code })).toBe(message);
  });

  test.each<FormValidationError>([
    { field: 'unrecognized_field', code: 'required' },
    { field: 'name', code: 'invalid' },
    { field: 'password', code: 'duplicate' },
    { field: 'times_of_day', code: 'unsorted' },
    { field: 'date', code: 'mismatch' },
    { field: 'recurrence', code: 'unknown_key' },
    { field: 'byday', code: 'too_many' },
    { field: 'other', code: 'out_of_range' },
  ])('fallback for $field / $code never exposes a raw code', (error) => {
    expect(formatValidationError(error)).toBe('Confira este campo.');
  });

  test('messages consume real shared validator results without changing the validators', () => {
    const errors = [
      ...validatePet({}), ...validateWeight({}), ...validateHealthEvent({}),
      ...validateTask({}), ...validatePassword(undefined),
    ];
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      const specific = cases.find((item) => item.field === error.field && item.code === error.code);
      expect(formatValidationError(error)).toBe(specific?.message ?? 'Confira este campo.');
    }
  });
});

describe('P4-1 standard toasts: 09 section 10', () => {
  test('lost completion attribution uses the family-local time', () => {
    expect(formatCompletionLost('Duda', instant, timezone)).toBe('Duda já tinha feito às 07:12');
  });
  test.each([
    ['mutationRejected', 'Uma alteração não pôde ser aplicada'],
    ['offlineQueued', 'Sem conexão — suas alterações serão enviadas depois'],
    ['weightRecorded', 'Peso registrado'],
    ['walkSaved', 'Passeio salvo'],
  ] as const)('%s', (key, expected) => {
    expect(strings.toasts[key]).toBe(expected);
  });
});
