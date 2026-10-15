import type { DateKey, FormValidationError, Recurrence } from '@pawlaris/shared';

export type ScheduleSummaryInput = {
  recurrence: Recurrence;
  timesOfDay: readonly string[];
};

export function formatTime(_instantMs: number, _timezone: string): string {
  throw new Error('formatTime not implemented');
}

export function formatShortDate(_date: DateKey): string {
  throw new Error('formatShortDate not implemented');
}

export function formatDayLabel(_date: DateKey): string {
  throw new Error('formatDayLabel not implemented');
}

export function formatDecimal(_value: number, _fractionDigits: number): string {
  throw new Error('formatDecimal not implemented');
}

export function formatDistance(_metres: number): string {
  throw new Error('formatDistance not implemented');
}

export function formatDuration(_seconds: number): string {
  throw new Error('formatDuration not implemented');
}

export function formatPace(_secondsPerKilometre: number | null): string {
  throw new Error('formatPace not implemented');
}

export function formatPetAge(_birthdate: DateKey, _today: DateKey): string {
  throw new Error('formatPetAge not implemented');
}

export function formatScheduleSummary(_input: ScheduleSummaryInput): string {
  throw new Error('formatScheduleSummary not implemented');
}

export function formatValidationError(_error: FormValidationError): string {
  throw new Error('formatValidationError not implemented');
}

export function formatCompletionLost(_name: string, _instantMs: number, _timezone: string): string {
  throw new Error('formatCompletionLost not implemented');
}
