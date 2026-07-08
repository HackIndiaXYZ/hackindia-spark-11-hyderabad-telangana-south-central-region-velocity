"""
File Risk - assesses the *identity* of an uploaded file (its name/
extension), independent of whatever text ai/file_scanner.py manages to pull
out of it. This is deliberately a separate, tiny detector rather than logic
bolted onto file_scanner.py: file_scanner's only job is text extraction,
and every other detector in this package (regex, presidio, secrets, ...)
already only reasons about content. Keeping "what kind of file is this"
separate means a file that fails to extract (e.g. a corrupted PDF, or a
binary key format we can't read as text at all) still gets evaluated -
some of the riskiest uploads (private keys, .env files) are exactly the
ones that either shouldn't be parsed as prose or aren't in the supported
extraction list at all.

Produces a normal DetectionResult (detector="file_type"), so it flows
through the SAME risk engine / policy engine / decision engine as every
other detector - no separate scoring or decision logic lives here.

Everything that counts as "inherently risky" is a plain data structure
below - adding a new risky filename pattern or extension is a one-line
change, no code restructuring required.

Scoring note: CRITICAL-tier identity findings below are deliberately given
a score high enough (80) to cross the Risk Engine's CRITICAL threshold
(>=75, see ai/risk_engine.py) on their own, with no other detector needing
to corroborate them - e.g. uploading a bare ".env" file BLOCKs by default
even if its contents happen to extract as empty text, matching the example
in the File Scanning spec ("Uploaded: .env -> Overall decision: BLOCK").
An admin can always override this via the Policy Engine (e.g. downgrade
"env_file" to WARN) since an explicit policy match always wins over the
default severity-based action - see ai/decision_engine.py.
"""
from ai.file_scanner import get_file_category, infer_extension
from schemas.detection import DetectionResult, Match, Recommendation, Severity

# --- Configuration: extend these to add new file-identity rules -----------

# Extensions that are inherently high risk regardless of content - the mere
# presence of this file type in an AI request is the finding.
CRITICAL_RISK_EXTENSIONS: dict[str, str] = {
    "env": "Environment file - frequently contains live API keys, database credentials, and secrets.",
    "pem": "PEM-encoded key/certificate material.",
    "key": "Private key file.",
    "pfx": "PKCS#12 certificate/key bundle.",
    "p12": "PKCS#12 certificate/key bundle.",
    "ppk": "PuTTY private key file.",
}

# Exact (case-insensitive) filenames that are inherently high risk even
# though their extension alone wouldn't be (e.g. "id_rsa" has no extension).
CRITICAL_RISK_FILENAMES: dict[str, str] = {
    "id_rsa": "SSH private key.",
    "id_dsa": "SSH private key.",
    "id_ecdsa": "SSH private key.",
    "id_ed25519": "SSH private key.",
    "credentials": "Cloud provider credentials file (e.g. AWS/GCP CLI credentials).",
    ".npmrc": "npm registry config - commonly contains auth tokens.",
    ".pypirc": "PyPI registry config - commonly contains auth tokens.",
}

# Filenames that deserve elevated (but not automatically CRITICAL) risk -
# these routinely embed secrets even though they're "just config".
ELEVATED_RISK_FILENAMES: dict[str, str] = {
    "docker-compose.yml": "Docker Compose file - environment blocks here commonly carry secrets.",
    "docker-compose.yaml": "Docker Compose file - environment blocks here commonly carry secrets.",
}

# Generic, low-severity identity categories - these exist so an admin can
# target them from the Policy Engine (e.g. "WARN on any source_code_file
# upload") without the default behavior itself being aggressive. Actual
# risky *content* inside these files is still caught by the normal
# detectors running over the extracted text (see ai/pipeline.py).
GENERIC_CATEGORY_LABELS: dict[str, str] = {
    "source_code": "SOURCE_CODE_FILE",
    "configuration": "CONFIG_FILE",
}


def _filename_only(path: str) -> str:
    return path.strip().replace("\\", "/").rsplit("/", 1)[-1]


def assess_file_identity_risk(filename: str) -> DetectionResult:
    """Pure identity check - no file content is inspected here."""
    base = _filename_only(filename)
    base_lower = base.lower()
    extension = infer_extension(base)

    # 1. Exact filename match (highest specificity).
    if base_lower in CRITICAL_RISK_FILENAMES:
        return _make_result(
            label="PRIVATE_KEY_OR_CREDENTIALS_FILE",
            severity=Severity.CRITICAL,
            score=80,
            recommendation=Recommendation.BLOCK,
            reason=f"'{base}' is a {CRITICAL_RISK_FILENAMES[base_lower]}",
            preview=base,
        )

    if base_lower in ELEVATED_RISK_FILENAMES:
        return _make_result(
            label="DOCKER_COMPOSE_FILE",
            severity=Severity.HIGH,
            score=50,
            recommendation=Recommendation.REDACT,
            reason=f"'{base}' is a {ELEVATED_RISK_FILENAMES[base_lower]}",
            preview=base,
        )

    # 2. Extension match.
    if extension in CRITICAL_RISK_EXTENSIONS:
        label = "ENV_FILE" if extension == "env" else "PRIVATE_KEY_OR_CREDENTIALS_FILE"
        return _make_result(
            label=label,
            severity=Severity.CRITICAL,
            score=80,
            recommendation=Recommendation.BLOCK,
            reason=f"'{base}' is a {CRITICAL_RISK_EXTENSIONS[extension]}",
            preview=base,
        )

    # 3. Generic category (low severity - a hook for policies, not a
    #    default block).
    category = get_file_category(base)
    if category in GENERIC_CATEGORY_LABELS:
        return _make_result(
            label=GENERIC_CATEGORY_LABELS[category],
            severity=Severity.LOW,
            score=10,
            recommendation=Recommendation.ALLOW,
            reason=f"'{base}' is a {category.replace('_', ' ')} file (.{extension or '?'}).",
            preview=base,
        )

    return _no_finding()


def assess_disallowed_extension(filename: str) -> DetectionResult:
    """Called by the pipeline when a file's extension isn't in the org's
    configured allowed_file_types - an explicit admin-controlled denylist
    rather than a hardcoded one (see models/settings.py OrgSettings)."""
    base = _filename_only(filename)
    return _make_result(
        label="DISALLOWED_FILE_TYPE",
        severity=Severity.CRITICAL,
        score=80,
        recommendation=Recommendation.BLOCK,
        reason=f"'{base}' has a file type that is not permitted by your organization's upload policy.",
        preview=base,
    )


def _make_result(
    *, label: str, severity: Severity, score: int, recommendation: Recommendation, reason: str, preview: str
) -> DetectionResult:
    return DetectionResult(
        detector="file_type",
        severity=severity,
        score=score,
        matches=[Match(label=label, value_preview=preview, start=None, end=None)],
        recommendation=recommendation,
        reason=reason,
    )


def _no_finding() -> DetectionResult:
    return DetectionResult(
        detector="file_type",
        severity=Severity.NONE,
        score=0,
        matches=[],
        recommendation=Recommendation.ALLOW,
        reason="No inherent risk associated with this file's name or type.",
    )
