"""
Policy Engine - admin-authored rules that can override the Risk Engine's
default action for a specific category of finding. Policies are evaluated
in priority order (lowest `priority` value first); the first enabled
policy whose `detection_type` matches wins.

`detection_type` can be either:
  - a fine-grained category (see _CATEGORY_MAP below) such as "api_key",
    "email", "phone", "credit_card", "jwt", "password", "pii", "ssh_key",
    or one of the File Scanning identity categories - "env_file",
    "credentials_file", "docker_compose_file", "source_code_file",
    "config_file", "disallowed_file_type" - matched against the individual
    Match.label values a detector produced. This is what lets an admin
    write "block API keys" WITHOUT also blocking every prompt that happens
    to mention an email address, even though both are found by the same
    regex detector, and equally "block .env uploads" without blocking
    every source-code upload.
  - a whole detector name ("regex", "presidio", "spacy", "source_code",
    "company_keyword", "secrets", "semantic", "file_type") or "all", for
    coarser rules like "redact anything Presidio finds", "block any
    detected secret", or "flag any file-identity risk regardless of which
    kind".

If no policy matches, the Decision Engine falls back to the Risk Engine's
severity-based default action.
"""
from pydantic import BaseModel

from models.policy import Policy
from schemas.detection import DetectionResult, Recommendation, Severity

# Match.label -> fine-grained policy category. Anything not listed here
# simply isn't selectable at that granularity (a policy author would target
# the parent detector name instead).
_CATEGORY_MAP: dict[str, str] = {
    "EMAIL": "email",
    "EMAIL_ADDRESS": "email",
    "PHONE_NUMBER": "phone",
    "CREDIT_CARD": "credit_card",
    "AWS_ACCESS_KEY": "api_key",
    "AWS_SECRET_KEY": "api_key",
    "GITHUB_TOKEN": "api_key",
    "GOOGLE_API_KEY": "api_key",
    "OPENAI_API_KEY": "api_key",
    "ANTHROPIC_API_KEY": "api_key",
    "HUGGINGFACE_TOKEN": "api_key",
    "REPLICATE_API_TOKEN": "api_key",
    "GROQ_API_KEY": "api_key",
    "PERPLEXITY_API_KEY": "api_key",
    "NOTION_API_KEY": "api_key",
    "SLACK_WEBHOOK_URL": "api_key",
    "DISCORD_WEBHOOK_URL": "api_key",
    "DB_CONNECTION_STRING": "api_key",
    "GENERIC_API_KEY": "api_key",
    "BEARER_TOKEN": "api_key",
    "JWT_TOKEN": "jwt",
    "PASSWORD": "password",
    "PERSON": "pii",
    "LOCATION": "pii",
    "ADDRESS": "pii",
    "GPE": "pii",
    "LOC": "pii",
    "IP_ADDRESS": "pii",
    "US_SSN": "pii",
    "US_PASSPORT": "pii",
    "IBAN_CODE": "pii",
    "Private Key": "ssh_key",
    "AWS Access Key": "api_key",
    # File Scanning identity categories (ai/file_risk.py) - deliberately
    # kept distinct from the content-based categories above (e.g. a
    # content-based "Private Key" match inside a prompt still maps to
    # "ssh_key"; a *file itself being* a private key maps to
    # "credentials_file") so an admin can target file-identity risk and
    # content-based risk independently.
    "ENV_FILE": "env_file",
    "PRIVATE_KEY_OR_CREDENTIALS_FILE": "credentials_file",
    "DOCKER_COMPOSE_FILE": "docker_compose_file",
    "SOURCE_CODE_FILE": "source_code_file",
    "CONFIG_FILE": "config_file",
    "DISALLOWED_FILE_TYPE": "disallowed_file_type",
}


class PolicyOutcome(BaseModel):
    policy_id: str
    policy_name: str
    action: Recommendation
    reason: str


def _fired_categories_and_detectors(results: list[DetectionResult]) -> tuple[set[str], set[str]]:
    categories: set[str] = set()
    detectors: set[str] = set()

    for r in results:
        if r.severity == Severity.NONE:
            continue
        detectors.add(r.detector)

        if r.detector == "source_code":
            categories.add("source_code")
        elif r.detector == "semantic":
            categories.add("semantic")
        elif r.detector == "company_keyword":
            categories.add("company_keyword")
        else:
            for match in r.matches:
                categories.add(_CATEGORY_MAP.get(match.label, r.detector))

    return categories, detectors


def evaluate_policies(results: list[DetectionResult], policies: list[Policy]) -> PolicyOutcome | None:
    categories, detectors = _fired_categories_and_detectors(results)

    for policy in policies:  # already sorted by priority in policy_service.get_enabled_policies
        matches = (
            policy.detection_type == "all"
            or policy.detection_type in categories
            or policy.detection_type in detectors
        )
        if not matches:
            continue

        try:
            action = Recommendation(policy.action.upper())
        except ValueError:
            continue  # misconfigured policy - skip rather than crash the scan

        return PolicyOutcome(
            policy_id=policy.id,
            policy_name=policy.name,
            action=action,
            reason=f"Policy '{policy.name}' triggered by detection type '{policy.detection_type}'.",
        )

    return None
