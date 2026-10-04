"""Create the complete server schema and its revision triggers."""

from uuid import uuid4

from alembic import op
from sqlalchemy import text

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(r"""
CREATE TABLE family_revision (
  family_id uuid   PRIMARY KEY,
  value     bigint NOT NULL DEFAULT 0
);
""")
    op.execute(r"""
CREATE TABLE server_meta (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  sync_epoch uuid NOT NULL
);
""")
    op.execute(r"""
CREATE EXTENSION IF NOT EXISTS citext;
""")
    op.execute(r"""
CREATE TABLE family (
  id         uuid PRIMARY KEY,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  timezone   text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  revision   bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);
""")
    op.execute(r"""
CREATE TYPE family_role AS ENUM ('leader', 'member');
""")
    op.execute(r"""
CREATE TABLE app_user (
  id            uuid PRIMARY KEY,
  family_id     uuid NOT NULL REFERENCES family(id),
  role          family_role NOT NULL DEFAULT 'member',
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  color         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz,
  revision      bigint NOT NULL,
  updated_at    timestamptz NOT NULL,
  deleted_at    timestamptz
);
""")
    op.execute(r"""
CREATE INDEX app_user_family ON app_user (family_id);
""")
    op.execute(r"""
CREATE TABLE refresh_token (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_user(id),
  chain_id   uuid NOT NULL,
  parent_id  uuid REFERENCES refresh_token(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
""")
    op.execute(r"""
CREATE INDEX refresh_token_chain ON refresh_token (chain_id);
""")
    op.execute(r"""
CREATE TABLE invite_code (
  code       text PRIMARY KEY,
  family_id  uuid NOT NULL REFERENCES family(id),
  role       family_role NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  used_by    uuid REFERENCES app_user(id)
);
""")
    op.execute(r"""
CREATE TABLE push_device (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
""")
    op.execute(r"""
CREATE INDEX push_device_user ON push_device (user_id);
""")
    op.execute(r"""
CREATE TYPE species AS ENUM ('cat', 'dog');
""")
    op.execute(r"""
CREATE TYPE pet_sex AS ENUM ('female', 'male', 'unknown');
""")
    op.execute(r"""
CREATE TABLE pet (
  id              uuid PRIMARY KEY,
  family_id       uuid NOT NULL REFERENCES family(id),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  species         species NOT NULL,
  sex             pet_sex NOT NULL DEFAULT 'unknown',
  breed           text,
  color           text,
  birthdate       date,
  microchip_id    text,
  avatar_asset_id uuid,
  notes           text,
  sort_order      int NOT NULL DEFAULT 0,
  archived_at     timestamptz,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  revision        bigint NOT NULL,
  updated_at      timestamptz NOT NULL,
  deleted_at      timestamptz
);
""")
    op.execute(r"""
CREATE INDEX pet_family_rev ON pet (family_id, revision);
""")
    op.execute(r"""
CREATE TABLE weight_entry (
  id          uuid PRIMARY KEY,
  family_id   uuid NOT NULL REFERENCES family(id),
  pet_id      uuid NOT NULL REFERENCES pet(id),
  weight_kg   numeric(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 120),
  measured_at timestamptz NOT NULL,
  note        text,
  created_by  uuid NOT NULL REFERENCES app_user(id),
  revision    bigint NOT NULL,
  updated_at  timestamptz NOT NULL,
  deleted_at  timestamptz
);
""")
    op.execute(r"""
CREATE INDEX weight_entry_family_rev ON weight_entry (family_id, revision);
""")
    op.execute(r"""
CREATE TYPE health_event_type AS ENUM
  ('vaccine','medication','vet_visit','symptom','procedure','other');
""")
    op.execute(r"""
CREATE TABLE health_event (
  id                  uuid PRIMARY KEY,
  family_id           uuid NOT NULL REFERENCES family(id),
  pet_id              uuid NOT NULL REFERENCES pet(id),
  type                health_event_type NOT NULL,
  title               text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  notes               text,
  occurred_at         timestamptz NOT NULL,
  next_due_on         date,
  attachment_asset_id uuid,
  created_by          uuid NOT NULL REFERENCES app_user(id),
  revision            bigint NOT NULL,
  updated_at          timestamptz NOT NULL,
  deleted_at          timestamptz
);
""")
    op.execute(r"""
CREATE INDEX health_event_family_rev ON health_event (family_id, revision);
""")
    op.execute(r"""
CREATE TYPE task_category AS ENUM
  ('feeding','medication','hygiene','litter','play','vet','other');
""")
    op.execute(r"""
CREATE TYPE completion_mode AS ENUM ('together','per_pet');
""")
    op.execute(r"""
CREATE TYPE reminder_class  AS ENUM ('critical','routine');
""")
    op.execute(r"""
CREATE TABLE task_template (
  id               uuid PRIMARY KEY,
  family_id        uuid NOT NULL REFERENCES family(id),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  description      text,
  category         task_category NOT NULL DEFAULT 'other',
  assigned_to      uuid REFERENCES app_user(id),
  requires_photo   boolean NOT NULL DEFAULT false,
  timer_seconds    int
                  CHECK (timer_seconds IS NULL OR timer_seconds BETWEEN 1 AND 86400),
  reminder_class   reminder_class NOT NULL DEFAULT 'routine',
  sort_order       int NOT NULL DEFAULT 0,
  recurrence       jsonb NOT NULL,
  times_of_day     text[] NOT NULL DEFAULT '{}',
  starts_on        date NOT NULL,
  pet_ids          uuid[] NOT NULL CHECK (cardinality(pet_ids) >= 1),
  completion_mode  completion_mode NOT NULL DEFAULT 'together',
  ends_on          date,
  replaces_task_id uuid REFERENCES task_template(id),
  created_by       uuid NOT NULL REFERENCES app_user(id),
  revision         bigint NOT NULL,
  updated_at       timestamptz NOT NULL,
  deleted_at       timestamptz
);
""")
    op.execute(r"""
CREATE INDEX task_template_family_rev ON task_template (family_id, revision);
""")
    op.execute(r"""
CREATE TABLE task_completion (
  id             uuid PRIMARY KEY,
  family_id      uuid NOT NULL REFERENCES family(id),
  task_id        uuid NOT NULL REFERENCES task_template(id),
  occurrence_key text NOT NULL
                 CHECK (occurrence_key ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$'),
  pet_id         uuid REFERENCES pet(id),
  completed_by   uuid NOT NULL REFERENCES app_user(id),
  completed_at   timestamptz NOT NULL,
  title_snapshot text NOT NULL,
  photo_asset_id uuid,
  note           text,
  undone_at      timestamptz,
  undone_by      uuid REFERENCES app_user(id),
  revision       bigint NOT NULL,
  updated_at     timestamptz NOT NULL
);
""")
    op.execute(r"""
CREATE UNIQUE INDEX task_completion_live
  ON task_completion (task_id, occurrence_key, pet_id) NULLS NOT DISTINCT
  WHERE undone_at IS NULL;
""")
    op.execute(r"""
CREATE INDEX task_completion_family_rev ON task_completion (family_id, revision);
""")
    op.execute(r"""
CREATE TABLE task_timer (
  id             uuid PRIMARY KEY,
  family_id      uuid NOT NULL REFERENCES family(id),
  task_id        uuid NOT NULL REFERENCES task_template(id),
  occurrence_key text NOT NULL
                 CHECK (occurrence_key ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$'),
  pet_id         uuid REFERENCES pet(id),
  started_by     uuid NOT NULL REFERENCES app_user(id),
  started_at     timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL CHECK (ends_at > started_at),
  cancelled_at   timestamptz,
  revision       bigint NOT NULL,
  updated_at     timestamptz NOT NULL
);
""")
    op.execute(r"""
CREATE INDEX task_timer_family_rev ON task_timer (family_id, revision);
""")
    op.execute(r"""
CREATE TYPE walk_status AS ENUM ('active','finished','discarded');
""")
    op.execute(r"""
CREATE TABLE walk_session (
  id                uuid PRIMARY KEY,
  family_id         uuid NOT NULL REFERENCES family(id),
  pet_id            uuid NOT NULL REFERENCES pet(id),
  user_id           uuid NOT NULL REFERENCES app_user(id),
  status            walk_status NOT NULL DEFAULT 'active',
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  paused_ms         bigint NOT NULL DEFAULT 0,
  distance_m        numeric(10,2) NOT NULL DEFAULT 0,
  duration_s        int NOT NULL DEFAULT 0,
  avg_pace_s_per_km int,
  point_count       int NOT NULL DEFAULT 0,
  preview           jsonb NOT NULL DEFAULT '[]',
  has_route         boolean NOT NULL DEFAULT false,
  note              text,
  revision          bigint NOT NULL,
  updated_at        timestamptz NOT NULL,
  deleted_at        timestamptz
);
""")
    op.execute(r"""
CREATE INDEX walk_session_family_rev ON walk_session (family_id, revision);
""")
    op.execute(r"""
CREATE TABLE walk_route (
  walk_id    uuid PRIMARY KEY REFERENCES walk_session(id),
  points     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
""")
    op.execute(r"""
CREATE TYPE asset_kind AS ENUM ('pet_avatar','task_proof','health_attachment');
""")
    op.execute(r"""
CREATE TABLE asset (
  id          uuid PRIMARY KEY,
  family_id   uuid NOT NULL REFERENCES family(id),
  kind        asset_kind NOT NULL,
  storage_key text NOT NULL,
  mime        text NOT NULL,
  bytes       int  NOT NULL,
  width       int  NOT NULL,
  height      int  NOT NULL,
  sha256      text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  created_at  timestamptz NOT NULL,
  revision    bigint NOT NULL,
  updated_at  timestamptz NOT NULL,
  deleted_at  timestamptz
);
""")
    op.execute(r"""
CREATE INDEX asset_family_rev ON asset (family_id, revision);
""")
    op.execute(r"""
CREATE TABLE applied_mutation (
  client_mutation_id uuid PRIMARY KEY,
  family_id          uuid NOT NULL,
  user_id            uuid NOT NULL,
  entity             text NOT NULL,
  entity_id          uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
""")
    op.execute(r"""
CREATE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  INSERT INTO family_revision (family_id, value) VALUES (NEW.family_id, 1)
  ON CONFLICT (family_id) DO UPDATE SET value = family_revision.value + 1
  RETURNING value INTO NEW.revision;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
""")
    op.execute(r"""
CREATE FUNCTION bump_revision_family() RETURNS trigger AS $$
BEGIN
  INSERT INTO family_revision (family_id, value) VALUES (NEW.id, 1)
  ON CONFLICT (family_id) DO UPDATE SET value = family_revision.value + 1
  RETURNING value INTO NEW.revision;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
""")
    op.execute(r"""
CREATE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'hard delete forbidden on %', TG_TABLE_NAME; END
$$ LANGUAGE plpgsql;
""")
    op.execute(r"""
CREATE INDEX family_rev ON family (id, revision);
""")
    op.execute(r"""
CREATE INDEX app_user_family_rev ON app_user (family_id, revision);
""")
    op.execute(r"""
CREATE TRIGGER family_bump BEFORE INSERT OR UPDATE ON family
  FOR EACH ROW EXECUTE FUNCTION bump_revision_family();
""")
    op.execute(r"""
CREATE TRIGGER family_no_delete BEFORE DELETE ON family
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER app_user_bump BEFORE INSERT OR UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER app_user_no_delete BEFORE DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER pet_bump BEFORE INSERT OR UPDATE ON pet
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER pet_no_delete BEFORE DELETE ON pet
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER weight_entry_bump BEFORE INSERT OR UPDATE ON weight_entry
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER weight_entry_no_delete BEFORE DELETE ON weight_entry
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER health_event_bump BEFORE INSERT OR UPDATE ON health_event
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER health_event_no_delete BEFORE DELETE ON health_event
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER task_template_bump BEFORE INSERT OR UPDATE ON task_template
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER task_template_no_delete BEFORE DELETE ON task_template
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER task_completion_bump BEFORE INSERT OR UPDATE ON task_completion
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER task_completion_no_delete BEFORE DELETE ON task_completion
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER task_timer_bump BEFORE INSERT OR UPDATE ON task_timer
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER task_timer_no_delete BEFORE DELETE ON task_timer
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER walk_session_bump BEFORE INSERT OR UPDATE ON walk_session
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER walk_session_no_delete BEFORE DELETE ON walk_session
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.execute(r"""
CREATE TRIGGER asset_bump BEFORE INSERT OR UPDATE ON asset
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
""")
    op.execute(r"""
CREATE TRIGGER asset_no_delete BEFORE DELETE ON asset
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
""")
    op.get_bind().execute(
        text("INSERT INTO server_meta (id, sync_epoch) VALUES (true, :epoch)"),
        {"epoch": uuid4()},
    )


def downgrade() -> None:
    op.execute("DROP TABLE applied_mutation")
    op.execute("DROP TABLE asset")
    op.execute("DROP TABLE walk_route")
    op.execute("DROP TABLE walk_session")
    op.execute("DROP TABLE task_timer")
    op.execute("DROP TABLE task_completion")
    op.execute("DROP TABLE task_template")
    op.execute("DROP TABLE health_event")
    op.execute("DROP TABLE weight_entry")
    op.execute("DROP TABLE pet")
    op.execute("DROP TABLE push_device")
    op.execute("DROP TABLE invite_code")
    op.execute("DROP TABLE refresh_token")
    op.execute("DROP TABLE app_user")
    op.execute("DROP TABLE family")
    op.execute("DROP TABLE server_meta")
    op.execute("DROP TABLE family_revision")
    op.execute("DROP FUNCTION forbid_delete()")
    op.execute("DROP FUNCTION bump_revision_family()")
    op.execute("DROP FUNCTION bump_revision()")
    op.execute("DROP TYPE asset_kind")
    op.execute("DROP TYPE walk_status")
    op.execute("DROP TYPE reminder_class")
    op.execute("DROP TYPE completion_mode")
    op.execute("DROP TYPE task_category")
    op.execute("DROP TYPE health_event_type")
    op.execute("DROP TYPE pet_sex")
    op.execute("DROP TYPE species")
    op.execute("DROP TYPE family_role")
    op.execute("DROP EXTENSION citext")
