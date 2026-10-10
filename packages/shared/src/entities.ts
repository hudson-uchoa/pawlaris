import type { DateKey } from './dates';
import type { Recurrence } from './recurrence';

type SyncRow = {
  id: string;
  revision: number | null;
  updated_at: string;
};
type DeletableRow = SyncRow & { deleted_at: string | null };

export type Family = DeletableRow & {
  name: string;
  timezone: string;
};

export type Member = DeletableRow & {
  display_name: string;
  role: 'leader' | 'member';
  color: string;
  disabled_at: string | null;
};

export type Pet = DeletableRow & {
  name: string;
  species: 'cat' | 'dog';
  sex: 'female' | 'male' | 'unknown';
  breed: string | null;
  color: string | null;
  birthdate: DateKey | null;
  microchip_id: string | null;
  avatar_asset_id: string | null;
  notes: string | null;
  sort_order: number;
  archived_at: string | null;
  created_by: string;
};

export type WeightEntry = DeletableRow & {
  pet_id: string;
  weight_kg: number;
  measured_at: string;
  note: string | null;
  created_by: string;
};

export type HealthEvent = DeletableRow & {
  pet_id: string;
  type: 'vaccine' | 'medication' | 'vet_visit' | 'symptom' | 'procedure' | 'other';
  title: string;
  notes: string | null;
  occurred_at: string;
  next_due_on: DateKey | null;
  attachment_asset_id: string | null;
  created_by: string;
};

export type TaskTemplate = DeletableRow & {
  title: string;
  description: string | null;
  category: 'feeding' | 'medication' | 'hygiene' | 'litter' | 'play' | 'vet' | 'other';
  assigned_to: string | null;
  requires_photo: boolean;
  timer_seconds: number | null;
  reminder_class: 'critical' | 'routine';
  sort_order: number;
  recurrence: Recurrence;
  times_of_day: string[];
  starts_on: DateKey;
  pet_ids: string[];
  completion_mode: 'together' | 'per_pet';
  ends_on: DateKey | null;
  replaces_task_id: string | null;
  created_by: string;
};

export type Completion = SyncRow & {
  task_id: string;
  occurrence_key: string;
  pet_id: string | null;
  completed_by: string;
  completed_at: string;
  title_snapshot: string;
  photo_asset_id: string | null;
  note: string | null;
  undone_at: string | null;
  undone_by: string | null;
  duplicate_of?: string | null;
};

export type Timer = SyncRow & {
  task_id: string;
  occurrence_key: string;
  pet_id: string | null;
  started_by: string;
  started_at: string;
  ends_at: string;
  cancelled_at: string | null;
};

export type Walk = DeletableRow & {
  pet_id: string;
  user_id: string;
  status: 'active' | 'finished' | 'discarded';
  started_at: string;
  ended_at: string | null;
  paused_ms: number;
  distance_m: number;
  duration_s: number;
  avg_pace_s_per_km: number | null;
  point_count: number;
  has_route: boolean;
  preview: [number, number][];
  note: string | null;
};

export type Asset = DeletableRow & {
  kind: 'pet_avatar' | 'task_proof' | 'health_attachment';
  mime: string;
  bytes: number;
  width: number;
  height: number;
  uploaded_by: string;
  created_at: string;
};
