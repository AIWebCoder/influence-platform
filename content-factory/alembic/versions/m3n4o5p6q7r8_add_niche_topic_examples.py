"""Add niches.topic_examples JSONB with seed examples

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-06-05 12:00:00.000000
"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB


revision = "m3n4o5p6q7r8"
down_revision = "l2m3n4o5p6q7"
branch_labels = None
depends_on = None

_SEED_EXAMPLES: dict[str, list[str]] = {
    "fitness": [
        "routine mobilite matinale pour teletravailleurs",
        "entrainement HIIT 15 minutes sans materiel",
        "erreurs de squat a eviter en salle",
    ],
    "food": [
        "meal prep proteine en moins de 30 minutes",
        "petit-dejeuner equilibre pour semaine chargee",
        "recette pasta legere facon restaurant",
    ],
    "travel": [
        "long week-end a Lisbonne petit budget",
        "itinerary 48h a Barcelone sans voiture",
        "astuces pour voyager leger en cabine seule",
    ],
    "business": [
        "premiers recrutements marketing pour une startup B2B",
        "comment structurer une offre en 3 paliers",
        "rituel hebdo de priorisation pour fondateur solo",
    ],
    "lifestyle": [
        "habitudes simples pour des matins plus calmes",
        "reset du dimanche soir pour une semaine sereine",
        "mini-routine skincare realiste apres le travail",
    ],
}


def upgrade() -> None:
    conn = op.get_bind()
    columns = {col["name"] for col in inspect(conn).get_columns("niches")}
    if "topic_examples" not in columns:
        op.add_column(
            "niches",
            sa.Column("topic_examples", JSONB, nullable=False, server_default="[]"),
        )
    for name, examples in _SEED_EXAMPLES.items():
        op.execute(
            sa.text(
                "UPDATE niches SET topic_examples = CAST(:examples AS jsonb) "
                "WHERE name = :name AND (topic_examples IS NULL OR topic_examples = '[]'::jsonb)"
            ).bindparams(examples=json.dumps(examples), name=name)
        )


def downgrade() -> None:
    conn = op.get_bind()
    columns = {col["name"] for col in inspect(conn).get_columns("niches")}
    if "topic_examples" in columns:
        op.drop_column("niches", "topic_examples")