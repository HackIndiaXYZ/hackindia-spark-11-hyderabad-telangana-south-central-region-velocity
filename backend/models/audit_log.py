"""
Audit trail for every prompt scanned. Powers the Prompt Logs page and
Analytics dashboard - this is the system of record for compliance.

Milestone 6 hardening note: `website`, `action`, and `risk` are indexed
because the Dashboard, Prompt Logs, and Analytics pages all filter/GROUP
BY these columns on every request (see services/analytics_service.py,
routers/prompt_logs.py). At demo-seed scale (a few hundred rows) this
makes no visible difference, but an unindexed GROUP BY becomes a full
table scan once a real org's audit_logs table reaches tens of thousands
of rows. `created_at` was already indexed (date-range queries); `user_id`
is implicitly indexed by MySQL InnoDB as a foreign key. Existing MySQL
databases created before this change need a one-time manual migration
(`Base.metadata.create_all()` only adds new tables, it doesn't alter
existing ones - this project has no Alembic):

    ALTER TABLE audit_logs ADD INDEX ix_audit_logs_website (website);
    ALTER TABLE audit_logs ADD INDEX ix_audit_logs_action (action);
    ALTER TABLE audit_logs ADD INDEX ix_audit_logs_risk (risk);

File Scanning note: `has_files`, `file_count`, and `files` were added so
the audit trail covers uploaded attachments as well as prompt text. `files`
stores ONLY metadata (filename, extension, category, size, mime type, risk,
score, which detectors fired, and per-file extraction/decision notes) -
never the raw file content, per the "do not store raw confidential file
contents in logs" requirement. Existing databases need:

    ALTER TABLE audit_logs ADD COLUMN has_files BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE audit_logs ADD INDEX ix_audit_logs_has_files (has_files);
    ALTER TABLE audit_logs ADD COLUMN file_count INT NOT NULL DEFAULT 0;
    ALTER TABLE audit_logs ADD COLUMN files JSON NOT NULL;
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Integer, Text, JSON, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)

    website: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # ChatGPT | Claude | Gemini

    original_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    sanitized_prompt: Mapped[str] = mapped_column(Text, nullable=False)

    risk: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # LOW | MEDIUM | HIGH | CRITICAL
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # ALLOW | WARN | REDACT | BLOCK
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Serialized list of DetectionResult summaries: [{detector, severity, score, reason}, ...]
    triggered_rules: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # File Scanning: metadata-only record of any attachments included in
    # this scan (see schemas/scan.py FileFindingSummary for the exact
    # shape). Deliberately excludes extracted/original file text.
    has_files: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    files: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
