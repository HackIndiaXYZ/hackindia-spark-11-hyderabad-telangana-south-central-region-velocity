"""
Prompt Logs API: a searchable, filterable, sortable, paginated view over
audit_logs, plus a full-detail endpoint for the Prompt Logs page's side
drawer. Read-only, RBAC-gated to admin/security_analyst - this is the
audit trail, not something regular employees can browse.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from auth.dependencies import require_analyst_or_admin
from database import get_db
from models.audit_log import AuditLog
from models.user import User
from schemas.prompt_logs import PromptLogDetail, PromptLogListItem, PromptLogListResponse, TriggeredRuleDetail

router = APIRouter(prefix="/api/prompt-logs", tags=["Prompt Logs"])

SORTABLE_COLUMNS = {"created_at": AuditLog.created_at, "score": AuditLog.score}


def _status_for(action: str) -> str:
    return "Clean" if action == "ALLOW" else "Flagged"


def _extract_policy(reason: str) -> str | None:
    match = re.search(r"Policy '([^']+)'", reason or "")
    return match.group(1) if match else None


@router.get("", response_model=PromptLogListResponse)
def list_prompt_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    action: str | None = None,
    risk: str | None = None,
    website: str | None = None,
    sort_by: str = Query("created_at", pattern="^(created_at|score)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_analyst_or_admin),
):
    query = select(AuditLog, User.full_name, User.email).join(User, User.id == AuditLog.user_id)
    count_query = select(func.count()).select_from(AuditLog).join(User, User.id == AuditLog.user_id)

    if search:
        like = f"%{search}%"
        clause = or_(User.full_name.ilike(like), User.email.ilike(like))
        query = query.where(clause)
        count_query = count_query.where(clause)
    if action:
        query = query.where(AuditLog.action == action.upper())
        count_query = count_query.where(AuditLog.action == action.upper())
    if risk:
        query = query.where(AuditLog.risk == risk.upper())
        count_query = count_query.where(AuditLog.risk == risk.upper())
    if website:
        query = query.where(AuditLog.website == website)
        count_query = count_query.where(AuditLog.website == website)

    total = db.scalar(count_query) or 0

    sort_column = SORTABLE_COLUMNS[sort_by]
    sort_column = sort_column.desc() if sort_dir == "desc" else sort_column.asc()
    query = query.order_by(sort_column).offset((page - 1) * page_size).limit(page_size)

    rows = db.execute(query).all()
    items = [
        PromptLogListItem(
            id=log.id,
            employee_name=full_name,
            employee_email=email,
            website=log.website,
            risk=log.risk,
            score=log.score,
            action=log.action,
            status=_status_for(log.action),
            created_at=log.created_at,
            has_files=log.has_files,
            file_count=log.file_count,
        )
        for log, full_name, email in rows
    ]

    total_pages = max(1, (total + page_size - 1) // page_size)
    return PromptLogListResponse(items=items, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/{log_id}", response_model=PromptLogDetail)
def get_prompt_log_detail(
    log_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_analyst_or_admin),
):
    row = db.execute(
        select(AuditLog, User.full_name, User.email, User.department)
        .join(User, User.id == AuditLog.user_id)
        .where(AuditLog.id == log_id)
    ).first()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prompt log not found")

    log, full_name, email, department = row

    return PromptLogDetail(
        id=log.id,
        employee_name=full_name,
        employee_email=email,
        department=department,
        website=log.website,
        risk=log.risk,
        score=log.score,
        action=log.action,
        reason=log.reason,
        triggered_policy=_extract_policy(log.reason),
        original_prompt=log.original_prompt,
        sanitized_prompt=log.sanitized_prompt,
        triggered_rules=[TriggeredRuleDetail(**rule) for rule in (log.triggered_rules or [])],
        created_at=log.created_at,
        files=log.files or [],
    )
