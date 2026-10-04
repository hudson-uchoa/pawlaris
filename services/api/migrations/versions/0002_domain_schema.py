"""Create the complete server schema and its revision triggers."""

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    raise NotImplementedError("not implemented")


def downgrade() -> None:
    raise NotImplementedError("not implemented")
