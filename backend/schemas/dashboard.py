"""Response schemas for GET /api/dashboard/summary."""
from datetime import datetime

from pydantic import BaseModel


class DailyActivityPoint(BaseModel):
    date: str
    ALLOW: int
    WARN: int
    REDACT: int
    BLOCK: int


class RiskDistributionPoint(BaseModel):
    risk: str
    count: int


class DetectorCount(BaseModel):
    detector: str
    count: int


class WebsiteUsagePoint(BaseModel):
    website: str
    count: int


class DepartmentUsagePoint(BaseModel):
    department: str
    count: int


class RecentActivityItem(BaseModel):
    id: str
    employee_name: str
    employee_email: str
    website: str
    action: str
    risk: str
    score: int
    created_at: datetime


class FileTypeBreakdownPoint(BaseModel):
    extension: str
    count: int


class FileCategoryPoint(BaseModel):
    category: str
    count: int


class FileScanStats(BaseModel):
    total_files_scanned: int
    blocked_uploads: int
    file_type_breakdown: list[FileTypeBreakdownPoint]
    top_sensitive_categories: list[FileCategoryPoint]


class DashboardSummary(BaseModel):
    security_score: int
    total_prompts: int
    allowed: int
    warned: int
    redacted: int
    blocked: int
    active_employees: int
    protected_websites: int

    daily_activity: list[DailyActivityPoint]
    risk_distribution: list[RiskDistributionPoint]
    top_violations: list[DetectorCount]
    website_usage: list[WebsiteUsagePoint]
    department_usage: list[DepartmentUsagePoint]
    recent_activity: list[RecentActivityItem]
    # File Scanning: additive - powers the Dashboard's "File Scanning" cards.
    file_stats: FileScanStats
