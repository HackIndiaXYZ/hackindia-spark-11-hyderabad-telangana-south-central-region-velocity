"""
POST /api/scan - the primary API consumed by the browser extension.

This router has zero detection logic of its own: it authenticates the
caller, hands the request to ai/pipeline.py, writes the audit log entry,
and returns the decision. All business logic lives in ai/ and services/.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ai.pipeline import run_pipeline
from auth.dependencies import get_current_user
from database import get_db
from models.user import User
from schemas.scan import ScanRequest, ScanResponse, TriggeredRule
from services.audit_service import log_scan

router = APIRouter(prefix="/api", tags=["Scan"])


@router.post("/scan", response_model=ScanResponse)
def scan_prompt(
    payload: ScanRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    output = run_pipeline(db=db, prompt=payload.prompt, site=payload.site, files=payload.files)
    decision = output.decision

    log_scan(
        db=db,
        user=current_user,
        site=payload.site,
        original_prompt=payload.prompt,
        sanitized_prompt=output.sanitized_prompt,
        decision=decision,
        file_findings=output.file_findings,
    )

    return ScanResponse(
        decision=decision.action.value,
        risk=decision.risk.value,
        score=decision.score,
        reason=decision.reason,
        sanitized_prompt=output.sanitized_prompt,
        findings=[TriggeredRule(**rule) for rule in decision.triggered_rules],
        file_findings=output.file_findings,
    )
