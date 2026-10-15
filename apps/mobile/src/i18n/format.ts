import {
  localTime, parseDateKey, petAge, utcDate,
  type DateKey, type FormValidationError, type Recurrence,
} from '@pawlaris/shared';
import { strings } from './strings';

export type ScheduleSummaryInput = {
  recurrence: Recurrence;
  timesOfDay: readonly string[];
};

const dayLabel = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
});
const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTime(instantMs: number, timezone: string): string {
  return localTime(instantMs, timezone);
}

export function formatShortDate(date: DateKey): string {
  const { d, m } = parseDateKey(date);
  return `${twoDigits(d)}/${twoDigits(m)}`;
}

export function formatDayLabel(date: DateKey): string {
  return dayLabel.format(utcDate(parseDateKey(date)));
}

export function formatDecimal(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatDistance(metres: number): string {
  return metres < 1000
    ? `${formatDecimal(metres, 0)} ${strings.format.metres}`
    : `${formatDecimal(metres / 1000, 2)} ${strings.format.kilometres}`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = twoDigits(seconds % 60);
  return seconds < 3600
    ? `${twoDigits(minutes)}:${remainder}`
    : `${Math.floor(minutes / 60)}:${twoDigits(minutes % 60)}:${remainder}`;
}

export function formatPace(secondsPerKilometre: number | null): string {
  if (secondsPerKilometre === null) return strings.format.unavailable;
  const minutes = twoDigits(Math.floor(secondsPerKilometre / 60));
  return `${minutes}:${twoDigits(secondsPerKilometre % 60)} ${strings.format.paceUnit}`;
}

export function formatPetAge(birthdate: DateKey, today: DateKey): string {
  const { years, months, days } = petAge(birthdate, today);
  const quantity = (value: number, units: readonly [string, string]): string =>
    `${value} ${units[value === 1 ? 0 : 1]}`;
  if (years > 0) {
    const yearLabel = quantity(years, strings.format.year);
    return months > 0
      ? `${yearLabel}${strings.format.conjunction}${quantity(months, strings.format.month)}`
      : yearLabel;
  }
  return months > 0
    ? quantity(months, strings.format.month)
    : quantity(days, strings.format.day);
}

export function formatScheduleSummary({ recurrence, timesOfDay }: ScheduleSummaryInput): string {
  const parts: string[] = [];
  if (recurrence.freq === 'once') {
    parts.push(strings.format.once, formatShortDate(recurrence.date));
  } else {
    if (recurrence.interval > 1) {
      parts.push(`${strings.format.every} ${recurrence.interval} ${strings.format.intervalUnits[recurrence.freq]}`);
    } else if (recurrence.freq === 'daily') {
      parts.push(strings.format.daily);
    }
    if (recurrence.freq === 'weekly') {
      const days = weekdays.filter((day) => recurrence.byday.includes(day))
        .map((day) => strings.format.weekdays[day]).join(', ');
      parts.push(days.charAt(0).toUpperCase() + days.slice(1));
    } else if (recurrence.freq === 'monthly') {
      const days = [...recurrence.bymonthday].sort((a, b) => a - b);
      const list = days.length === 1 ? String(days[0])
        : `${days.slice(0, -1).join(', ')}${strings.format.conjunction}${days[days.length - 1]}`;
      parts.push(`${strings.format.monthDay[days.length === 1 ? 0 : 1]} ${list}`);
    }
  }
  if (timesOfDay.length > 0) parts.push([...timesOfDay].sort().join(', '));
  else if (recurrence.freq !== 'once') parts.push(strings.format.allDay);
  return parts.join(' · ');
}

export function formatValidationError(error: FormValidationError): string {
  return strings.validation.rules.find((rule) => rule.code === error.code
    && rule.fields.some((field) => field === error.field))?.message ?? strings.validation.fallback;
}

export function formatCompletionLost(name: string, instantMs: number, timezone: string): string {
  return `${name} ${strings.format.completionLost} ${formatTime(instantMs, timezone)}`;
}
