import type { components } from './api-types';
import type * as Local from './entities';

type Wire = components['schemas'];
type Assert<T extends true> = T;
type Assignable<L, W> = [L] extends [W] ? true : false;
type Mutual<L, W> = Assignable<L, W> extends true ? Assignable<W, L> : false;

// Pending phone rows have no server revision yet (10 §3). Compare the
// non-null local revision with the wire revision, in both directions.
type EntityContract<
  L extends { revision: number | null },
  W extends { revision: number },
  Refined extends keyof L & keyof W = never,
> = Mutual<keyof L, keyof W> extends true
  ? Mutual<Exclude<L['revision'], null>, W['revision']> extends true
    ? {
        [K in Exclude<keyof L & keyof W, 'revision'>]: K extends Refined
          ? Assignable<L[K], W[K]>
          : Mutual<L[K], W[K]>;
      }[Exclude<keyof L & keyof W, 'revision'>] extends true
      ? true
      : false
    : false
  : false;

export type EntityContracts = [
  Assert<EntityContract<Local.Family, Wire['Family']>>,
  Assert<EntityContract<Local.Member, Wire['Member']>>,
  Assert<EntityContract<Local.Pet, Wire['Pet']>>,
  Assert<EntityContract<Local.WeightEntry, Wire['WeightEntry']>>,
  Assert<EntityContract<Local.HealthEvent, Wire['HealthEvent']>>,
  // Recurrence is a validated domain union; the wire accepts open JSON objects.
  Assert<EntityContract<Local.TaskTemplate, Wire['TaskTemplate'], 'recurrence'>>,
  Assert<EntityContract<Local.Completion, Wire['Completion']>>,
  Assert<EntityContract<Local.Timer, Wire['Timer']>>,
  // Preview coordinates are pairs locally; the wire accepts number lists.
  Assert<EntityContract<Local.Walk, Wire['Walk'], 'preview'>>,
  Assert<EntityContract<Local.Asset, Wire['Asset']>>,
];

// @ts-expect-error An added local key must fail the exact-key check.
export type RejectAddedKey = Assert<EntityContract<Local.Family & { extra: string }, Wire['Family']>>;
// @ts-expect-error A missing local key must fail the exact-key check.
export type RejectMissingKey = Assert<EntityContract<Omit<Local.Family, 'name'>, Wire['Family']>>;
// @ts-expect-error A scalar type change must fail field compatibility.
export type RejectScalarDrift = Assert<EntityContract<Omit<Local.Family, 'name'> & { name: number }, Wire['Family']>>;
// @ts-expect-error One-sided nullability must fail bidirectional compatibility.
export type RejectNullableDrift = Assert<EntityContract<Omit<Local.Family, 'name'> & { name: string | null }, Wire['Family']>>;
