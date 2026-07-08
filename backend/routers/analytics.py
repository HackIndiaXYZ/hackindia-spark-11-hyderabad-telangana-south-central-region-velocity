"""
GET /api/analytics/summary - powers the Analytics page's Recharts. Shares
services/analytics_service.py with the Dashboard endpoint rather than
duplicating any query logic.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth.dependencies import require_analyst_or_admin
from database import get_db
from models.user import User
from schemas.analytics import AnalyticsSummary
import services.analytics_service as analytics

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
def get_analytics_summary(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_analyst_or_admin),
):
    counts = analytics.action_counts(db)

    return AnalyticsSummary(
        daily_activity=analytics.daily_activity(db),
        blocked_vs_allowed={"ALLOW": counts["ALLOW"], "BLOCK": counts["BLOCK"]},
        risk_trend=analytics.risk_trend(db),
        top_triggered_rules=analytics.top_triggered_rules(db),
        website_usage=analytics.website_usage(db),
        department_usage=analytics.department_usage(db),
        top_employees_by_violations=analytics.top_employees_by_violations(db),
        file_stats=analytics.file_scan_stats(db),
    )
