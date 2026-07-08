"""Schemas for GET /api/prompt-logs (list) and GET /api/prompt-logs/{id} (detail)."""
from datetime import datetime

from pydantic import BaseModel

from schemas.scan import FileFindingSummary


class PromptLogListItem(BaseModel):
    id: str
    employee_name: str
    employee_email: str
    website: str
    risk: str
    score: int
    action: str
    status: str  # "Clean" | "Flagged" - derived from action
    created_at: datetime
    # File Scanning: additive - lets the list view show a paperclip/count
    # badge without a second request per row.
    has_files: bool = False
    file_count: int = 0


class PromptLogListResponse(BaseModel):
    items: list[PromptLogListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class TriggeredRuleDetail(BaseModel):
    detector: str
    severity: str
    score: int
    reason: str


class PromptLogDetail(BaseModel):
    id: str
    employee_name: str
    employee_email: str
    department: str | None
    website: str
    risk: str
    score: int
    action: str
    reason: str
    triggered_policy: str | None
    original_prompt: str
    sanitized_prompt: str
    triggered_rules: list[TriggeredRuleDetail]
    created_at: datetime
    # File Scanning: additive - populates the drawer's "Attached Files" section.
    files: list[FileFindingSummary] = []
