"""
Regex Detector - fast, deterministic pattern matching for structured
sensitive data: emails, phone numbers, credit cards, API keys, JWTs, cloud
provider credentials, webhook URLs, database connection strings, and
generic URLs. Runs first because it's cheap and catches the
highest-confidence, highest-severity findings (live secrets) before any
NLP model has to run.

Coverage is deliberately split with ai/secret_detector.py (detect-secrets)
rather than duplicated: detect-secrets already ships dedicated, well-tested
plugins for AWS, Azure, GitHub, GitLab, Slack tokens, Stripe, Twilio,
SendGrid, Discord bot tokens, NPM, PyPI, and PEM/SSH private keys, so those
aren't repeated here. Everything below fills genuine gaps neither
detect-secrets nor Presidio/spaCy cover: newer AI-provider key formats
(Anthropic, Hugging Face, Replicate, Groq, Perplexity - all now as
commonly leaked as OpenAI's), Notion integration tokens, incoming webhook
URLs (a distinct leak vector from the bot/API tokens detect-secrets already
catches), a generic "Bearer <token>" header catch-all, and an explicit
database-connection-string pattern for a friendlier, more specific label
than detect-secrets' generic BasicAuthDetector reason text.
"""
import re

from schemas.detection import SEVERITY_RANK, DetectionResult, Match, Recommendation, Severity

# Every label in this set is treated as a live, high-confidence credential
# leak -> BLOCK rather than REDACT/WARN. Keep this in sync with any new
# CRITICAL-severity API-key/credential pattern added below.
_CRITICAL_LABELS: set[str] = {
    "AWS_ACCESS_KEY",
    "AWS_SECRET_KEY",
    "GITHUB_TOKEN",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "HUGGINGFACE_TOKEN",
    "REPLICATE_API_TOKEN",
    "GROQ_API_KEY",
    "PERPLEXITY_API_KEY",
    "NOTION_API_KEY",
    "SLACK_WEBHOOK_URL",
    "DISCORD_WEBHOOK_URL",
    "DB_CONNECTION_STRING",
    "GENERIC_API_KEY",
    "BEARER_TOKEN",
}

# (label, pattern, severity, score-per-match). Ordered cheapest/most
# specific first within each group; every credential pattern is anchored
# with \b and a bounded character class (no nested/unbounded quantifiers),
# so none of these carry catastrophic-backtracking risk even on long input.
_PATTERNS: list[tuple[str, re.Pattern, Severity, int]] = [
    ("EMAIL", re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"), Severity.LOW, 8),
    (
        "PHONE_NUMBER",
        re.compile(r"(?<!\d)(\+?\d{1,3}[-.\s]?)?(\(?\d{3,4}\)?[-.\s]?)\d{3}[-.\s]?\d{3,4}(?!\d)"),
        Severity.LOW,
        6,
    ),
    ("CREDIT_CARD", re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"), Severity.HIGH, 30),
    # --- Cloud providers ---
    ("AWS_ACCESS_KEY", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"), Severity.CRITICAL, 45),
    ("AWS_SECRET_KEY", re.compile(r"(?i)aws_secret_access_key\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{40}['\"]?"), Severity.CRITICAL, 45),
    ("GITHUB_TOKEN", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"), Severity.CRITICAL, 45),
    ("GOOGLE_API_KEY", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"), Severity.CRITICAL, 40),
    # --- AI / LLM providers ---
    # Anthropic keys look like sk-ant-api03-xxxx-xxxx-xxxx (hyphen-separated
    # segments), so they never matched OPENAI_API_KEY's pattern below, which
    # requires one unbroken run of alphanumerics after "sk-". This has to be
    # checked first since "sk-ant-..." would otherwise also partially satisfy
    # a looser generic "sk-" prefix check.
    ("ANTHROPIC_API_KEY", re.compile(r"\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b"), Severity.CRITICAL, 45),
    # OpenAI's newer project-scoped keys (sk-proj-..., sk-svcacct-...,
    # sk-admin-...) also use hyphens as segment separators, same problem as
    # Anthropic above - a body class of alphanumerics-only would miss them
    # exactly the way the old pattern missed Anthropic keys. Widened to
    # allow hyphens/underscores in the body; the (?!ant-) guard keeps this
    # from ever double-matching an Anthropic key.
    ("OPENAI_API_KEY", re.compile(r"\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b"), Severity.CRITICAL, 40),
    ("HUGGINGFACE_TOKEN", re.compile(r"\bhf_[A-Za-z0-9]{34}\b"), Severity.CRITICAL, 40),
    ("REPLICATE_API_TOKEN", re.compile(r"\br8_[A-Za-z0-9]{37,40}\b"), Severity.CRITICAL, 40),
    ("GROQ_API_KEY", re.compile(r"\bgsk_[A-Za-z0-9]{52}\b"), Severity.CRITICAL, 40),
    ("PERPLEXITY_API_KEY", re.compile(r"\bpplx-[A-Za-z0-9]{40,56}\b"), Severity.CRITICAL, 40),
    # --- SaaS / productivity ---
    ("NOTION_API_KEY", re.compile(r"\b(?:secret_[A-Za-z0-9]{43}|ntn_[A-Za-z0-9]{40,50})\b"), Severity.CRITICAL, 40),
    # --- Incoming webhook URLs - a distinct leak vector from the bot/API
    # tokens detect-secrets' SlackDetector/DiscordBotTokenDetector already
    # catch: anyone with the URL can post as the integration, no auth
    # header needed, so these are just as dangerous as a token and easy to
    # miss since they don't "look like" a credential.
    (
        "SLACK_WEBHOOK_URL",
        re.compile(r"\bhttps://hooks\.slack\.com/services/T[A-Za-z0-9]+/B[A-Za-z0-9]+/[A-Za-z0-9]+\b"),
        Severity.CRITICAL,
        40,
    ),
    (
        "DISCORD_WEBHOOK_URL",
        re.compile(r"\bhttps://discord(?:app)?\.com/api/webhooks/\d+/[\w-]+\b"),
        Severity.CRITICAL,
        40,
    ),
    # --- Databases - explicit pattern for a friendlier, more specific
    # label than detect-secrets' generic BasicAuthDetector reason text;
    # intentionally kept alongside it rather than replacing it (defense in
    # depth), since this one is scoped to known DB URI schemes only.
    (
        "DB_CONNECTION_STRING",
        re.compile(r"\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp)://[^\s:@/]+:[^\s@]+@[^\s]+\b"),
        Severity.CRITICAL,
        45,
    ),
    (
        "JWT_TOKEN",
        re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
        Severity.HIGH,
        35,
    ),
    # --- Generic, context-based catch-alls ---
    (
        "GENERIC_API_KEY",
        re.compile(r"(?i)\b(api[_-]?key|secret[_-]?key|access[_-]?token)\b\s*[:=]\s*['\"]?[A-Za-z0-9\-_]{16,}['\"]?"),
        Severity.HIGH,
        30,
    ),
    (
        "BEARER_TOKEN",
        re.compile(r"(?i)\bBearer\s+[A-Za-z0-9\-_.=]{20,}\b"),
        Severity.HIGH,
        30,
    ),
    (
        "PASSWORD",
        re.compile(r"(?i)\b(password|passwd|pwd)\b\s*[:=]\s*['\"]?\S{4,}['\"]?"),
        Severity.HIGH,
        25,
    ),
    ("URL", re.compile(r"https?://[^\s<>\"']+"), Severity.NONE, 2),
]


def _luhn_valid(digits: str) -> bool:
    total = 0
    reverse_digits = digits[::-1]
    for i, ch in enumerate(reverse_digits):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _mask(value: str, label: str) -> str:
    digits_only = re.sub(r"\D", "", value)
    if label in {"CREDIT_CARD", "PHONE_NUMBER"} and len(digits_only) >= 4:
        return f"****{digits_only[-4:]}"
    if len(value) <= 8:
        return value[0] + "*" * (len(value) - 1)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"


def detect_regex(text: str) -> DetectionResult:
    matches: list[Match] = []
    total_score = 0
    highest_severity = Severity.NONE
    hit_labels: set[str] = set()

    for label, pattern, severity, score in _PATTERNS:
        for m in pattern.finditer(text):
            value = m.group(0)

            if label == "CREDIT_CARD":
                digits = re.sub(r"\D", "", value)
                if not (13 <= len(digits) <= 19) or not _luhn_valid(digits):
                    continue

            matches.append(
                Match(label=label, value_preview=_mask(value, label), start=m.start(), end=m.end())
            )
            total_score += score
            hit_labels.add(label)
            if SEVERITY_RANK[severity] > SEVERITY_RANK[highest_severity]:
                highest_severity = severity

    total_score = min(total_score, 100)

    if not matches:
        return DetectionResult(
            detector="regex",
            severity=Severity.NONE,
            score=0,
            matches=[],
            recommendation=Recommendation.ALLOW,
            reason="No regex-matched patterns found.",
        )

    critical_hit = any(label in _CRITICAL_LABELS for label in hit_labels)
    recommendation = (
        Recommendation.BLOCK
        if critical_hit
        else Recommendation.REDACT
        if highest_severity in {Severity.HIGH, Severity.MEDIUM}
        else Recommendation.WARN
        if highest_severity == Severity.LOW
        else Recommendation.ALLOW
    )

    return DetectionResult(
        detector="regex",
        severity=highest_severity,
        score=total_score,
        matches=matches,
        recommendation=recommendation,
        reason=f"Matched: {', '.join(sorted(hit_labels))}.",
    )
