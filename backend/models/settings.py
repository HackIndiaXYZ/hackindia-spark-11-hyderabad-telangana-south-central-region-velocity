"""
Organization-wide settings - a singleton row (there is exactly one
OrgSettings record per deployment, created lazily on first read by
services/settings_service.py). Company keywords and policies remain their
own tables (CompanyKeyword, Policy) since they're naturally lists rather
than scalar settings.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class OrgSettings(Base):
    __tablename__ = "org_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    organization_name: Mapped[str] = mapped_column(String(200), default="Acme Corp", nullable=False)
    risk_threshold: Mapped[int] = mapped_column(Integer, default=70, nullable=False)

    supported_websites: Mapped[list] = mapped_column(JSON, default=lambda: ["ChatGPT", "Claude", "Gemini"])
    # File Scanning: the full extraction-capable set from ai/file_scanner.py
    # (documents, source code, configuration, data, logs, images) is allowed
    # by default; an admin can narrow this from the Settings page at any
    # time (enforced in ai/pipeline.py via ai/file_risk.py's
    # assess_disallowed_extension - anything removed from this list is
    # rejected before its content is even extracted).
    allowed_file_types: Mapped[list] = mapped_column(
        JSON,
        default=lambda: [
            # Documents
            "pdf", "docx", "txt",
            # Source code
            "java", "py", "js", "jsx", "ts", "tsx", "cpp", "cc", "cxx", "h", "hpp", "c", "cs",
            "go", "rs", "php", "html", "htm", "css", "sql",
            # Configuration
            "env", "properties", "yaml", "yml", "json", "xml",
            # Data
            "csv", "xlsx",
            # Logs
            "log",
            # Images (OCR)
            "png", "jpg", "jpeg",
        ],
    )
    theme_default: Mapped[str] = mapped_column(String(10), default="light", nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
