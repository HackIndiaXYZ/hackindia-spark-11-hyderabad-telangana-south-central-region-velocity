"""Response schemas for GET /api/analytics/summary."""
from pydantic import BaseModel

from schemas.dashboard import DailyActivityPoint, DepartmentUsagePoint, DetectorCount, FileScanStats, WebsiteUsagePoint


class RiskTrendPoint(BaseModel):
    date: str
    average_risk_score: float


class TopEmployeeViolation(BaseModel):
    full_name: str
    email: str
    department: str | None
    violation_count: int


class AnalyticsSummary(BaseModel):
    daily_activity: list[DailyActivityPoint]
    blocked_vs_allowed: dict[str, int]
    risk_trend: list[RiskTrendPoint]
    top_triggered_rules: list[DetectorCount]
    website_usage: list[WebsiteUsagePoint]
    department_usage: list[DepartmentUsagePoint]
    top_employees_by_violations: list[TopEmployeeViolation]
    file_stats: FileScanStats
