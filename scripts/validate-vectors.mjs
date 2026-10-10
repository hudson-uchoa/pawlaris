#!/usr/bin/env node
/**
 * Validates the golden-vector fixtures — spec/07-test-harness.md §3.
 * Checks shape and coverage only. It does NOT run the engine; that is the job
 * of `test:shared`. Node built-ins only.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, 'spec/fixtures', name), 'utf8'));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY = /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const REQUIRED_TAGS = [
  'daily', 'weekly', 'monthly', 'once', 'all-day', 'multi-time', 'key-format',
  'leap-day', 'month-end', 'bymonthday-skip', 'starts-on', 'ends-on',
  'mid-interval', 'weekly-interval', 'year-boundary', 'empty',
];
const MIN_RECURRENCE_VECTORS = 30;

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const isRealDate = (s) => {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const isSortedUnique = (a) => a.every((x, i) => i === 0 || a[i - 1] < x);
const uniqueNames = (list, where) => {
  const seen = new Set();
  for (const v of list) {
    if (typeof v.name !== 'string' || v.name.length === 0) fail(where, 'a vector has no name');
    else if (seen.has(v.name)) fail(where, `duplicate name "${v.name}"`);
    seen.add(v.name);
  }
};

// ---- recurrence-vectors.json ----------------------------------------------
{
  const f = load('recurrence-vectors.json');
  const where = 'recurrence-vectors.json';
  if (!Array.isArray(f.vectors)) fail(where, '`vectors` must be an array');
  const vectors = f.vectors ?? [];
  if (vectors.length < MIN_RECURRENCE_VECTORS) {
    fail(where, `needs at least ${MIN_RECURRENCE_VECTORS} vectors, has ${vectors.length}`);
  }
  uniqueNames(vectors, where);

  const tags = new Set();
  for (const v of vectors) {
    const at = `${where} "${v.name}"`;
    for (const t of v.tags ?? []) tags.add(t);
    if (!Array.isArray(v.tags) || v.tags.length === 0) fail(at, 'needs at least one tag');

    const r = v.recurrence ?? {};
    if (!['daily', 'weekly', 'monthly', 'once'].includes(r.freq)) fail(at, `bad freq ${r.freq}`);
    if (r.freq !== 'once' && !(Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 365)) {
      fail(at, 'interval must be an integer 1–365');
    }
    if (r.freq === 'weekly' && !(Array.isArray(r.byday) && r.byday.length > 0
      && r.byday.every((d) => WEEKDAYS.includes(d)) && new Set(r.byday).size === r.byday.length)) {
      fail(at, 'byday must be 1–7 unique weekday codes');
    }
    if (r.freq === 'monthly' && !(Array.isArray(r.bymonthday) && r.bymonthday.length > 0
      && r.bymonthday.every((d) => Number.isInteger(d) && d >= 1 && d <= 31)
      && new Set(r.bymonthday).size === r.bymonthday.length)) {
      fail(at, 'bymonthday must be 1–31 unique integers in 1..31');
    }
    if (r.freq === 'once' && !(isRealDate(r.date ?? '') && r.date === v.starts_on)) {
      fail(at, 'once: `date` must be a real date equal to starts_on');
    }

    if (!Array.isArray(v.times_of_day) || !v.times_of_day.every((t) => TIME.test(t))
      || !isSortedUnique(v.times_of_day)) {
      fail(at, 'times_of_day must be sorted, unique HH:mm strings');
    }
    for (const k of ['starts_on', 'from', 'to']) if (!isRealDate(v[k] ?? '')) fail(at, `${k} is not a real date`);
    if (v.ends_on !== null && !isRealDate(v.ends_on ?? '')) fail(at, 'ends_on must be null or a real date');

    if (!Array.isArray(v.expect)) { fail(at, '`expect` must be an array'); continue; }
    if (!isSortedUnique(v.expect)) fail(at, '`expect` must be ascending with no duplicates');
    const allDay = (v.times_of_day ?? []).length === 0;
    for (const key of v.expect) {
      if (!KEY.test(key)) { fail(at, `bad key ${key}`); continue; }
      const [date, time] = key.split('T');
      if (!isRealDate(date)) fail(at, `key ${key} is not a real date`);
      if (allDay && time !== undefined) fail(at, `all-day vector has a timed key ${key}`);
      if (!allDay && !v.times_of_day.includes(time)) fail(at, `key ${key} uses a time not in times_of_day`);
      if (date < v.from || date > v.to) fail(at, `key ${key} is outside [from, to]`);
      if (date < v.starts_on) fail(at, `key ${key} is before starts_on`);
      if (v.ends_on !== null && date > v.ends_on) fail(at, `key ${key} is after ends_on`);
    }
  }
  for (const t of REQUIRED_TAGS) if (!tags.has(t)) fail(where, `no vector carries the required tag "${t}"`);
  // An interval is anchored to starts_on. Only a range that begins in an off
  // period tells that apart from anchoring to `from`, and each frequency has
  // its own arithmetic, so each needs such a vector.
  for (const freq of ['daily', 'weekly', 'monthly']) {
    if (!(f.vectors ?? []).some((v) => v.recurrence?.freq === freq && (v.tags ?? []).includes('mid-interval'))) {
      fail(where, `no ${freq} vector carries the tag "mid-interval"`);
    }
  }
}

// ---- time-vectors.json -----------------------------------------------------
{
  const f = load('time-vectors.json');
  const where = 'time-vectors.json';
  const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

  for (const group of ['localDate', 'localTime', 'slotInstant']) {
    if (!Array.isArray(f[group]) || f[group].length === 0) fail(where, `\`${group}\` must be a non-empty array`);
    else uniqueNames(f[group], `${where} ${group}`);
  }
  for (const v of f.localDate ?? []) {
    const at = `${where} localDate "${v.name}"`;
    if (!INSTANT.test(v.instant ?? '')) fail(at, 'instant must be ISO UTC with seconds');
    if (!validTz(v.tz)) fail(at, `unknown timezone ${v.tz}`);
    if (!isRealDate(v.expect ?? '')) fail(at, 'expect must be a date');
  }
  for (const v of f.localTime ?? []) {
    const at = `${where} localTime "${v.name}"`;
    if (!INSTANT.test(v.instant ?? '')) fail(at, 'instant must be ISO UTC with seconds');
    if (!validTz(v.tz)) fail(at, `unknown timezone ${v.tz}`);
    if (!TIME.test(v.expect ?? '')) fail(at, 'expect must be HH:mm');
  }
  for (const v of f.slotInstant ?? []) {
    const at = `${where} slotInstant "${v.name}"`;
    if (!isRealDate(v.date ?? '')) fail(at, 'date is not a real date');
    if (!TIME.test(v.time ?? '')) fail(at, 'time must be HH:mm');
    if (!validTz(v.tz)) fail(at, `unknown timezone ${v.tz}`);
    if (!INSTANT.test(v.expect ?? '')) fail(at, 'expect must be ISO UTC with seconds');
  }
  const zones = new Set((f.slotInstant ?? []).map((v) => v.tz));
  // West of UTC alone does not pin the algorithm: with a negative offset, probing
  // the offset at the wall time itself gives the same answers as probing it a
  // day earlier. London and Sydney, east of UTC with DST, tell the two apart.
  for (const tz of ['America/Sao_Paulo', 'America/New_York', 'Europe/London', 'Australia/Sydney']) {
    if (!zones.has(tz)) fail(where, `slotInstant has no vector for ${tz}`);
  }
}

// ---- reseed-vectors.json ---------------------------------------------------
{
  const f = load('reseed-vectors.json');
  const where = 'reseed-vectors.json';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ENTITIES = [
    'members', 'family', 'pets', 'task_templates', 'weight_entries', 'health_events',
    'task_completions', 'task_timers', 'walk_sessions', 'walk_routes',
  ];
  const RESEED_TAGS = [
    'insert', 'older', 'newer', 'order', 'clamp', 'archive', 'tombstone', 'completion',
    'duplicate', 'timer', 'walk', 'walk-route', 'refused', 'members', 'family',
  ];
  const COUNTS = ['inserted', 'updated', 'unchanged', 'duplicates', 'refused'];
  const MIN_RESEED_VECTORS = 20;

  if (!INSTANT.test(f.now ?? '')) fail(where, '`now` must be ISO UTC with seconds');
  if (typeof f.base !== 'object' || f.base === null) fail(where, '`base` must be an object');
  if (!Array.isArray(f.vectors)) fail(where, '`vectors` must be an array');
  const vectors = f.vectors ?? [];
  if (vectors.length < MIN_RESEED_VECTORS) {
    fail(where, `needs at least ${MIN_RESEED_VECTORS} vectors, has ${vectors.length}`);
  }
  uniqueNames(vectors, where);

  const checkRow = (at, entity, row, { instant }) => {
    if (!ENTITIES.includes(entity)) return fail(at, `unknown entity ${entity}`);
    const id = entity === 'walk_routes' ? row?.walk_id : row?.id;
    if (!UUID.test(id ?? '')) fail(at, `${entity} row has no UUIDv4 id`);
    if (instant && entity !== 'walk_routes' && !INSTANT.test(row?.updated_at ?? '')) {
      fail(at, `${entity} row needs updated_at as ISO UTC with seconds`);
    }
  };
  const checkGroup = (at, group, opts) => {
    for (const [entity, rows] of Object.entries(group ?? {})) {
      if (!Array.isArray(rows)) fail(at, `${entity} must be an array`);
      else for (const row of rows) checkRow(at, entity, row, opts);
    }
  };

  const tags = new Set();
  for (const v of vectors) {
    const at = `${where} "${v.name}"`;
    if (!Array.isArray(v.tags) || v.tags.length === 0) fail(at, 'needs at least one tag');
    for (const t of v.tags ?? []) {
      if (!RESEED_TAGS.includes(t)) fail(at, `unknown tag ${t}`);
      tags.add(t);
    }
    checkGroup(`${at} server`, v.server, { instant: true });
    checkGroup(`${at} other_family`, v.other_family, { instant: true });
    if (!Array.isArray(v.incoming) || v.incoming.length === 0) {
      fail(at, '`incoming` must be a non-empty array');
      continue;
    }
    for (const item of v.incoming) checkRow(`${at} incoming`, item.entity, item.row, { instant: true });

    const e = v.expect ?? {};
    if (!e.rows && !e.absent) fail(at, 'expect needs `rows` or `absent`');
    checkGroup(`${at} expect.rows`, e.rows, { instant: false });
    checkGroup(`${at} expect.other_family`, e.other_family, { instant: false });
    for (const [entity, ids] of Object.entries(e.absent ?? {})) {
      if (!ENTITIES.includes(entity)) fail(at, `absent names unknown entity ${entity}`);
      if (!Array.isArray(ids) || !ids.every((id) => UUID.test(id))) fail(at, `absent.${entity} must list ids`);
    }
    const r = e.result ?? {};
    for (const c of COUNTS) {
      if (!Number.isInteger(r[c]) || r[c] < 0) fail(at, `result.${c} must be a non-negative integer`);
    }
    if (r.inserted + r.updated + r.unchanged + r.refused !== v.incoming.length) {
      fail(at, 'inserted + updated + unchanged + refused must equal the number of incoming rows');
    }
  }
  for (const t of RESEED_TAGS) if (!tags.has(t)) fail(where, `no vector tagged ${t}`);
}

if (errors.length) {
  console.error(`Fixture validation failed (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('Fixtures valid: recurrence-vectors.json, time-vectors.json, reseed-vectors.json');
