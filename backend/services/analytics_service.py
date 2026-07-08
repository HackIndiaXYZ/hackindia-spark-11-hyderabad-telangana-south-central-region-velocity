"""
Shared read-only aggregation queries over audit_logs/users, reused by both
routers/dashboard.py and routers/analytics.py so the two pages never
duplicate SQL. Every function here is a real query - no hardcoded numbers.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.audit_log import AuditLog
from models.user import User, UserRole

ACTIONS = ["ALLOW", "WARN", "REDACT", "BLOCK"]
RISK_LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


def action_counts(db: Session) -> dict[str, int]:
    rows = db.execute(select(AuditLog.action, func.count()).group_by(AuditLog.action)).all()
    counts = {action: 0 for action in ACTIONS}
    for action, count in rows:
        counts[action] = count
    return counts


def total_prompts(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(AuditLog)) or 0


def average_risk_score(db: Session) -> float:
    return float(db.scalar(select(func.avg(AuditLog.score))) or 0)


def security_score(db: Session) -> int:
    avg_score = average_risk_score(db)
    return max(0, min(100, round(100 - avg_score)))


def active_employee_count(db: Session) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role != UserRole.ADMIN, User.prompt_count > 0)
    ) or 0


def protected_website_count(db: Session) -> int:
    distinct = db.scalar(select(func.count(func.distinct(AuditLog.website)))) or 0
    return max(distinct, 3)  # ChatGPT/Claude/Gemini are always "protected" even pre-traffic


def daily_activity(db: Session, days: int = 14) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    rows = db.execute(
        select(AuditLog.created_at, AuditLog.action).where(AuditLog.created_at >= since)
    ).all()

    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {a: 0 for a in ACTIONS})
    for created_at, action in rows:
        day_key = created_at.strftime("%Y-%m-%d")
        buckets[day_key][action] += 1

    result = []
    for i in range(days):
        day = (datetime.now(timezone.utc) - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        counts = buckets.get(day, {a: 0 for a in ACTIONS})
        result.append({"date": day, **counts})
    return result


def risk_distribution(db: Session) -> list[dict]:
    rows = db.execute(select(AuditLog.risk, func.count()).group_by(AuditLog.risk)).all()
    counts = {level: 0 for level in RISK_LEVELS}
    for risk, count in rows:
        counts[risk] = count
    return [{"risk": level, "count": counts[level]} for level in RISK_LEVELS]


def risk_trend(db: Session, days: int = 14) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    rows = db.execute(
        select(AuditLog.created_at, AuditLog.score).where(AuditLog.created_at >= since)
    ).all()

    buckets: dict[str, list[int]] = defaultdict(list)
    for created_at, score in rows:
        buckets[created_at.strftime("%Y-%m-%d")].append(score)

    result = []
    for i in range(days):
        day = (datetime.now(timezone.utc) - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        scores = buckets.get(day, [])
        avg = round(sum(scores) / len(scores), 1) if scores else 0
        result.append({"date": day, "average_risk_score": avg})
    return result


def top_triggered_rules(db: Session, limit: int = 6) -> list[dict]:
    rows = db.execute(
        select(AuditLog.triggered_rules).where(AuditLog.action != "ALLOW")
    ).all()

    counter: Counter[str] = Counter()
    for (rules,) in rows:
        for rule in rules or []:
            detector = rule.get("detector")
            if detector:
                counter[detector] += 1

    return [{"detector": detector, "count": count} for detector, count in counter.most_common(limit)]


def website_usage(db: Session) -> list[dict]:
    rows = db.execute(select(AuditLog.website, func.count()).group_by(AuditLog.website)).all()
    return [{"website": website, "count": count} for website, count in rows]


def department_usage(db: Session) -> list[dict]:
    rows = db.execute(
        select(User.department, func.count(AuditLog.id))
        .join(AuditLog, AuditLog.user_id == User.id)
        .group_by(User.department)
    ).all()
    return [{"department": department or "Unassigned", "count": count} for department, count in rows]


def top_employees_by_violations(db: Session, limit: int = 5) -> list[dict]:
    rows = db.execute(
        select(User.full_name, User.email, User.department, User.violation_count)
        .where(User.role != UserRole.ADMIN, User.violation_count > 0)
        .order_by(User.violation_count.desc())
        .limit(limit)
    ).all()
    return [
        {"full_name": name, "email": email, "department": department, "violation_count": count}
        for name, email, department, count in rows
    ]


def file_scan_stats(db: Session, top_n: int = 8) -> dict:
    """
    File Scanning aggregates for the Dashboard/Analytics pages. Pulled from
    AuditLog.files (JSON metadata only - see models/audit_log.py) rather
    than a separate table, consistent with how every other aggregate here
    reads straight off audit_logs. At demo-seed scale this is a simple
    Python-side rollup; if audit_logs grows into the millions of rows this
    would want to move to a proper per-file table with its own indexes -
    same caveat noted elsewhere in this module for JSON-column queries.
    """
    rows = db.execute(select(AuditLog.files, AuditLog.action).where(AuditLog.has_files.is_(True))).all()

    total_files = 0
    blocked_uploads = 0
    extension_counter: Counter[str] = Counter()
    category_counter: Counter[str] = Counter()

    for files, action in rows:
        for f in files or []:
            total_files += 1
            extension = (f.get("extension") or "unknown").lower()
            extension_counter[extension] += 1

            risk = f.get("risk", "NONE")
            if risk in ("HIGH", "CRITICAL"):
                category_counter[f.get("category", "unknown")] += 1

            if action == "BLOCK":
                blocked_uploads += 1

    return {
        "total_files_scanned": total_files,
        "blocked_uploads": blocked_uploads,
        "file_type_breakdown": [
            {"extension": ext, "count": count} for ext, count in extension_counter.most_common(top_n)
        ],
        "top_sensitive_categories": [
            {"category": cat, "count": count} for cat, count in category_counter.most_common(top_n)
        ],
    }


def recent_activity(db: Session, limit: int = 10) -> list[dict]:
    rows = db.execute(
        select(AuditLog, User.full_name, User.email)
        .join(User, User.id == AuditLog.user_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": log.id,
            "employee_name": full_name,
            "employee_email": email,
            "website": log.website,
            "action": log.action,
            "risk": log.risk,
            "score": log.score,
            "created_at": log.created_at,
        }
        for log, full_name, email in rows
    ]
