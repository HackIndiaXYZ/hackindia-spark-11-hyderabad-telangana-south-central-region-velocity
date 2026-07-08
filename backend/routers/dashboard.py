"""
GET /api/dashboard/summary - powers the Dashboard page's cards, charts,
and recent-activity table in one request. Everything is a live aggregate
over audit_logs/users (services/analytics_service.py) - nothing hardcoded.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth.dependencies import require_analyst_or_admin
from database import get_db
from models.user import User
from schemas.dashboard import DashboardSummary
import services.analytics_service as analytics

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_analyst_or_admin),
):
    counts = analytics.action_counts(db)

    return DashboardSummary(
        security_score=analytics.security_score(db),
        total_prompts=analytics.total_prompts(db),
        allowed=counts["ALLOW"],
        warned=counts["WARN"],
        redacted=counts["REDACT"],
        blocked=counts["BLOCK"],
        active_employees=analytics.active_employee_count(db),
        protected_websites=analytics.protected_website_count(db),
        daily_activity=analytics.daily_activity(db),
        risk_distribution=analytics.risk_distribution(db),
        top_violations=analytics.top_triggered_rules(db),
        website_usage=analytics.website_usage(db),
        department_usage=analytics.department_usage(db),
        recent_activity=analytics.recent_activity(db),
        file_stats=analytics.file_scan_stats(db),
    )
