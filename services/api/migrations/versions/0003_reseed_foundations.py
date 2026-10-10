"""Preserve reseed change times and record duplicate completions."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(r"""
CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  INSERT INTO family_revision (family_id, value) VALUES (NEW.family_id, 1)
  ON CONFLICT (family_id) DO UPDATE SET value = family_revision.value + 1
  RETURNING value INTO NEW.revision;
  IF current_setting('pawlaris.reseed', true) = 'on' AND NEW.updated_at IS NOT NULL THEN
    NULL;                       -- keep the supplied instant
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
""")
    op.execute(r"""
CREATE OR REPLACE FUNCTION bump_revision_family() RETURNS trigger AS $$
BEGIN
  INSERT INTO family_revision (family_id, value) VALUES (NEW.id, 1)
  ON CONFLICT (family_id) DO UPDATE SET value = family_revision.value + 1
  RETURNING value INTO NEW.revision;
  IF current_setting('pawlaris.reseed', true) = 'on' AND NEW.updated_at IS NOT NULL THEN
    NULL;                       -- keep the supplied instant
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
""")
    op.execute(r"""
ALTER TABLE task_completion
  ADD COLUMN duplicate_of uuid REFERENCES task_completion(id);
""")


def downgrade() -> None:
    op.execute(r"""
CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  INSERT INTO family_revision (family_id, value) VALUES (NEW.family_id, 1)
  ON CONFLICT (family_id) DO UPDATE SET value = family_revision.value + 1
  RETURNING value INTO NEW.revision;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
""")
    op.execute(r"""
CREATE OR REPLACE FUNCTION bump_revision_family() RETURNS trigger AS $$
BEGIN
  INSERT INTO family_revision (family_id, value) VALUES (NEW.id, 1)
  ON CONFLICT (family_id) DO UPDATE SET value = family_revision.value + 1
  RETURNING value INTO NEW.revision;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
""")
    op.execute("ALTER TABLE task_completion DROP COLUMN duplicate_of")
