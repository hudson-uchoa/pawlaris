import {
  addDays, isDateKey, localDate, localTime, parseDateKey, petAge, slotInstant, utcDate,
  type DateKey, type FormValidationError, type Pet, type PetListKind, type Recurrence,
} from '@pawlaris/shared';
import { strings } from './strings';

export type ScheduleSummaryInput = {
  recurrence: Recurrence;
  timesOfDay: readonly string[];
};

const dayLabel = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
});
const monthLabel = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC', month: 'long', year: 'numeric',
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

export function formatCarryOverDate(date: DateKey): string {
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
  return `${weekday.format(utcDate(parseDateKey(date)))}, ${formatShortDate(date)}`;
}

export function formatFullDate(date: DateKey): string {
  const { y, m, d } = parseDateKey(date);
  return `${twoDigits(d)}/${twoDigits(m)}/${String(y).padStart(4, '0')}`;
}

// Q-48: a task that has not started can take effect later than tomorrow.
export function formatTaskEffectiveDate(effective: DateKey, today: DateKey): string {
  if (effective === today) return strings.tasks.effectiveToday;
  if (effective === addDays(today, 1)) return strings.tasks.effectiveTomorrow;
  return strings.tasks.effectiveDate(formatFullDate(effective));
}

export function parseFullDate(value: string): DateKey | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (match === null) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return isDateKey(date) ? date : null;
}

export function formatMonth(month: string): string {
  return monthLabel.format(utcDate(parseDateKey(`${month}-01`)));
}

export function formatDateTime(instantMs: number, timezone: string): string {
  return `${formatFullDate(localDate(instantMs, timezone))} ${formatTime(instantMs, timezone)}`;
}

export function parseDateTime(value: string, timezone: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) ([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (match === null) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  if (!isDateKey(date)) return null;
  return slotInstant(date, `${match[4]}:${match[5]}`, timezone);
}

export function formatPetListValue(species: Pet['species'], kind: PetListKind, value: string): string {
  const names: Readonly<Record<string, string>> = strings.pets[kind === 'breed' ? 'breeds' : 'coats'][species];
  return Object.hasOwn(names, value) ? names[value] ?? value : value;
}

export function formatPetSummary(pet: Pet, now: number, timezone: string): string {
  const parts = [strings.pets.profileSpecies[pet.species][pet.sex]];
  const age = pet.birthdate === null ? null : formatPetAge(pet.birthdate, localDate(now, timezone));
  return [...parts, ...(age === null ? [] : [age]),
    pet.breed ? formatPetListValue(pet.species, 'breed', pet.breed) : strings.pets.mixedBreed,
    ...(pet.color ? [formatPetListValue(pet.species, 'coat', pet.color)] : [])].join(' · ');
}

export function formatDayLabel(date: DateKey): string {
  return dayLabel.format(utcDate(parseDateKey(date)));
}

export function formatDashboardDay(date: DateKey, today: DateKey): string {
  if (date === today) return strings.dashboard.today;
  if (date === addDays(today, -1)) return strings.dashboard.yesterday;
  if (date === addDays(today, 1)) return strings.dashboard.tomorrow;
  return formatDayLabel(date);
}

export function formatCareDue(daysUntil: number): string {
  if (daysUntil === 0) return strings.dashboard.dueToday;
  return daysUntil < 0 ? strings.dashboard.overdueBy(-daysUntil) : strings.dashboard.dueIn(daysUntil);
}

export function formatDecimal(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatDistance(metres: number): string {
  const wholeMetres = Math.round(metres);
  return wholeMetres < 1000
    ? `${formatDecimal(wholeMetres, 0)} ${strings.format.metres}`
    : `${formatDecimal(wholeMetres / 1000, 2)} ${strings.format.kilometres}`;
}

export function formatDuration(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = twoDigits(wholeSeconds % 60);
  return wholeSeconds < 3600
    ? `${twoDigits(minutes)}:${remainder}`
    : `${Math.floor(minutes / 60)}:${twoDigits(minutes % 60)}:${remainder}`;
}

export function formatPace(secondsPerKilometre: number | null): string {
  if (secondsPerKilometre === null) return strings.format.unavailable;
  const wholeSeconds = Math.round(secondsPerKilometre);
  const minutes = twoDigits(Math.floor(wholeSeconds / 60));
  return `${minutes}:${twoDigits(wholeSeconds % 60)} ${strings.format.paceUnit}`;
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
