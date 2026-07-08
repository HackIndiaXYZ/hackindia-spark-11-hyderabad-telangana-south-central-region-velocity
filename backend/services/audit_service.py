"""
Audit Logger - the system of record for every prompt scanned. Writes an
AuditLog row and keeps the acting user's running prompt/violation counters
in sync (used by the Employees dashboard page in a later milestone).
"""
from sqlalchemy.orm import Session

from ai.decision_engine import Decision
from models.audit_log import AuditLog
from models.user import User
from schemas.detection import Recommendation
from schemas.scan import FileFindingSummary


def log_scan(
    db: Session,
    user: User,
    site: str,
    original_prompt: str,
    sanitized_prompt: str,
    decision: Decision,
    file_findings: list[FileFindingSummary] | None = None,
) -> AuditLog:
    file_findings = file_findings or []

    entry = AuditLog(
        user_id=user.id,
        website=site,
        original_prompt=original_prompt,
        sanitized_prompt=sanitized_prompt,
        risk=decision.risk.value,
        score=decision.score,
        action=decision.action.value,
        reason=decision.reason,
        triggered_rules=decision.triggered_rules,
        has_files=len(file_findings) > 0,
        file_count=len(file_findings),
        # model_dump(): metadata only (filename/extension/category/size/
        # mime_type/risk/score/extraction status) - never raw file content,
        # see FileFindingSummary in schemas/scan.py.
        files=[f.model_dump() for f in file_findings],
    )
    db.add(entry)

    user.prompt_count += 1
    if decision.action != Recommendation.ALLOW:
        user.violation_count += 1

    db.commit()
    db.refresh(entry)
    return entry
