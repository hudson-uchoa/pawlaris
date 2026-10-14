import type {
  Asset, Completion, Family, HealthEvent, Member, Pet, TaskTemplate,
  Timer, Walk, WeightEntry,
} from '@pawlaris/shared';
import type { SqlDriver } from './driver';

export interface EntityRows {
  members: Member;
  family: Family;
  pets: Pet;
  task_templates: TaskTemplate;
  weight_entries: WeightEntry;
  health_events: HealthEvent;
  task_completions: Completion;
  task_timers: Timer;
  walk_sessions: Walk;
  assets: Asset;
}
export type SyncEntity = keyof EntityRows;
export interface ReplicaMetadata {
  pending: boolean;
  deleted: boolean;
  pullGen: number;
}
export interface ReplicaRecord<E extends SyncEntity = SyncEntity> extends ReplicaMetadata {
  entity: E;
  id: string;
  revision: number | null;
  sortKey: string | null;
  row: EntityRows[E];
}
export interface ReseedCursor {
  entity: SyncEntity;
  id: string;
}

interface StoredReplica {
  entity: SyncEntity;
  id: string;
  revision: number | null;
  pending: number;
  deleted: number;
  pull_gen: number;
  sort_key: string | null;
  json: string;
}

function decode<E extends SyncEntity = SyncEntity>(stored: StoredReplica): ReplicaRecord<E> {
  return {
    entity: stored.entity as E, id: stored.id, revision: stored.revision,
    pending: stored.pending === 1, deleted: stored.deleted === 1,
    pullGen: stored.pull_gen, sortKey: stored.sort_key,
    row: JSON.parse(stored.json) as EntityRows[E],
  };
}

function sortKey(entity: SyncEntity, row: EntityRows[SyncEntity]): string | null {
  if (entity === 'task_completions' && 'occurrence_key' in row) return row.occurrence_key;
  if ('measured_at' in row) return row.measured_at;
  if ('occurred_at' in row) return row.occurred_at;
  if ('started_at' in row && 'status' in row) return row.started_at;
  return null;
}

export class ReplicaRepo {
  constructor(private readonly driver: SqlDriver) {}

  get<E extends SyncEntity>(entity: E, id: string): ReplicaRecord<E> | null {
    const stored = this.driver.all<StoredReplica>(
      'SELECT * FROM replica WHERE entity = ? AND id = ?', [entity, id],
    )[0];
    return stored === undefined ? null : decode<E>(stored);
  }
  upsert<E extends SyncEntity>(entity: E, row: EntityRows[E], metadata: ReplicaMetadata): void {
    this.driver.run(`
      INSERT OR REPLACE INTO replica (
        entity, id, revision, pending, deleted, pull_gen, sort_key, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [entity, row.id, row.revision, Number(metadata.pending), Number(metadata.deleted),
      metadata.pullGen, sortKey(entity, row), JSON.stringify(row)]);
  }
  remove(entity: SyncEntity, id: string): void {
    this.driver.run('DELETE FROM replica WHERE entity = ? AND id = ?', [entity, id]);
  }
  allExceptOldCompletions(cutoff: string): ReplicaRecord[] {
    return this.driver.all<StoredReplica>(`
      SELECT * FROM replica WHERE deleted = 0
        AND (entity != 'task_completions' OR sort_key >= ?)
      ORDER BY entity, id
    `, [cutoff]).map((stored) => decode(stored));
  }
  range<E extends SyncEntity>(entity: E, from: string, to: string): ReplicaRecord<E>[] {
    return this.driver.all<StoredReplica>(`
      SELECT * FROM replica WHERE entity = ? AND deleted = 0
        AND sort_key >= ? AND sort_key <= ? ORDER BY sort_key, id
    `, [entity, from, to]).map((stored) => decode<E>(stored));
  }
  clearSynced(): void {
    this.driver.run(`
      DELETE FROM replica WHERE NOT EXISTS (
        SELECT 1 FROM outbox WHERE outbox.entity = replica.entity
          AND outbox.entity_id = replica.id
      )
    `);
  }
  sweepUnmarked(pullGen: number): void {
    this.driver.run(`
      DELETE FROM replica WHERE pull_gen != ? AND NOT EXISTS (
        SELECT 1 FROM outbox WHERE outbox.entity = replica.entity
          AND outbox.entity_id = replica.id
      )
    `, [pullGen]);
  }
  pageForReseed(after: ReseedCursor | null, limit: number): ReplicaRecord[] {
    // Rank on disk: only this page's JSON is decoded into JavaScript.
    // Keep filtered rows in the ranking so they can still locate a cursor.
    return this.driver.all<StoredReplica>(`
      WITH RECURSIVE template_depth (id, depth) AS (
        SELECT r.id, 0 FROM replica r WHERE r.entity = 'task_templates'
          AND NOT EXISTS (
            SELECT 1 FROM replica parent WHERE parent.entity = 'task_templates'
              AND parent.id = json_extract(r.json, '$.replaces_task_id')
          )
        UNION ALL
        SELECT child.id, parent.depth + 1 FROM replica child
          JOIN template_depth parent ON parent.id = json_extract(child.json, '$.replaces_task_id')
          WHERE child.entity = 'task_templates'
      ), ordered AS (
        SELECT r.*, COALESCE(t.depth, 0) AS depth,
          CASE r.entity
            WHEN 'members' THEN 0 WHEN 'family' THEN 1 WHEN 'pets' THEN 2
            WHEN 'task_templates' THEN 3 WHEN 'weight_entries' THEN 4
            WHEN 'health_events' THEN 5 WHEN 'task_completions' THEN 6
            WHEN 'task_timers' THEN 7 WHEN 'walk_sessions' THEN 8
          END AS entity_order,
          CASE WHEN r.entity = 'task_completions'
            AND json_extract(r.json, '$.duplicate_of') IS NOT NULL THEN 1 ELSE 0
          END AS duplicate_order
        FROM replica r LEFT JOIN template_depth t
          ON r.entity = 'task_templates' AND t.id = r.id
        WHERE r.entity != 'assets'
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          ORDER BY entity_order, depth, duplicate_order, id
        ) AS position FROM ordered
      )
      SELECT * FROM ranked r
      WHERE position > COALESCE((
        SELECT position FROM ranked WHERE entity = ? AND id = ?
      ), 0) AND r.revision IS NOT NULL AND NOT (r.entity = 'walk_sessions' AND EXISTS (
        SELECT 1 FROM outbox WHERE outbox.entity = r.entity AND outbox.entity_id = r.id
      ))
      ORDER BY position LIMIT ?
    `, [after?.entity ?? null, after?.id ?? null, limit]).map((stored) => decode(stored));
  }
}
