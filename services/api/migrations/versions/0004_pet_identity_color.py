"""Add the optional pet identity palette key."""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pet ADD COLUMN identity_color text")


def downgrade() -> None:
    op.execute("ALTER TABLE pet DROP COLUMN identity_color")
