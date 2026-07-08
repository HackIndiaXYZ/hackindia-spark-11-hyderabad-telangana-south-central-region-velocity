"""
Pipeline Orchestrator - wires every stage of the AI Detection Engine
together in the order defined by the architecture doc:

  normalize -> regex -> presidio -> spacy -> source code -> company
  keyword -> secrets -> file scanner (per file: identity risk + same
  content detectors as the prompt) -> semantic classifier (only if
  inconclusive) -> risk engine -> policy engine -> decision engine ->
  redactor

This is the single entrypoint routers/scan.py calls. No detection logic
lives in the router - it only handles HTTP concerns and auditing.

File Scanning note: prompt and files are combined into ONE list of
DetectionResults before risk/policy/decision runs, so a request with both a
prompt and attachments gets exactly one unified decision (see the module
docstring in ai/risk_engine.py and ai/decision_engine.py - neither knows or
cares whether a given DetectionResult came from the prompt or a file). That
unified decision continues to govern the PROMPT TEXT (redaction/gating).

Separately, EACH file also gets its own independent action (see
_scan_one_file / FileFindingSummary.action), computed from only that file's
own findings - policies and severity thresholds are evaluated a second
time, scoped to one file, purely so the extension can gate files
individually (upload the clean ones, hold back the risky one) instead of
one bad attachment vetoing an entire batch. Per-file summaries never feed
back into the overall/unified decision a second time.
"""
import base64
import logging
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy.orm import Session

from ai.code_detector import detect_source_code
from ai.decision_engine import Decision, decide
from ai.file_risk import assess_disallowed_extension, assess_file_identity_risk
from ai.file_scanner import extract_text_from_file, get_file_category, infer_extension
from ai.keyword_detector import detect_company_keywords
from ai.normalizer import normalize_prompt
from ai.policy_engine import evaluate_policies
from ai.presidio_detector import detect_presidio
from ai.regex_detector import detect_regex
from ai.risk_engine import assess_risk
from ai.secret_detector import detect_secrets_in_text
from ai.semantic_classifier import classify_semantic_risk, should_run_semantic_classifier
from ai.spacy_detector import detect_spacy
from models.policy import Policy
from schemas.detection import DetectionResult, Recommendation, Severity
from schemas.scan import FileFindingSummary, ScanFileInput
from services.keyword_service import get_enabled_keywords
from services.policy_service import get_enabled_policies
from services.settings_service import get_or_create_settings

logger = logging.getLogger("promptshield.ai.pipeline")


@dataclass
class PipelineOutput:
    decision: Decision
    sanitized_prompt: str
    all_results: list[DetectionResult]
    file_findings: list[FileFindingSummary] = field(default_factory=list)


def _safe_call(detector_name: str, fn: Callable[[], DetectionResult]) -> DetectionResult:
    """
    Milestone 6 hardening: every detector used to be called directly, so an
    unexpected exception in any ONE of them (a malformed-unicode edge case,
    a third-party library bug, anything not already caught internally)
    took down the entire /api/scan request with a 500 - no audit log entry,
    and a security tool that fails a *legitimate* prompt because of its own
    bug is worse than one that logs the failure and keeps scanning with the
    other eight detectors. This wraps every detector call so one broken
    detector degrades to a neutral result instead of failing the whole scan.
    """
    try:
        return fn()
    except Exception:
        logger.exception("Detector '%s' raised an unhandled exception - degrading to a neutral result.", detector_name)
        return DetectionResult(
            detector=detector_name,
            severity=Severity.NONE,
            score=0,
            matches=[],
            recommendation=Recommendation.ALLOW,
            reason=f"{detector_name} detector failed unexpectedly and was skipped for this scan.",
        )


def _run_deterministic_detectors(text: str, keywords: list[str]) -> list[DetectionResult]:
    """Regex -> Presidio -> spaCy -> Source Code -> Company Keyword -> Secrets."""
    return [
        _safe_call("regex", lambda: detect_regex(text)),
        _safe_call("presidio", lambda: detect_presidio(text)),
        _safe_call("spacy", lambda: detect_spacy(text)),
        _safe_call("source_code", lambda: detect_source_code(text)),
        _safe_call("company_keyword", lambda: detect_company_keywords(text, keywords)),
        _safe_call("secrets", lambda: detect_secrets_in_text(text)),
    ]


def _tag_with_source(results: list[DetectionResult], source_label: str) -> list[DetectionResult]:
    """Prefix each result's reason with its origin (e.g. an uploaded file) while
    keeping the DetectionResult schema itself identical across the board."""
    tagged = []
    for r in results:
        tagged.append(r.model_copy(update={"reason": f"[{source_label}] {r.reason}"}))
    return tagged


def _scan_one_file(
    file_input: ScanFileInput,
    keywords: list[str],
    allowed_extensions: set[str],
    policies: list[Policy],
) -> tuple[list[DetectionResult], FileFindingSummary]:
    """Runs one uploaded file through identity-risk assessment and (if its
    extension is both allowed and extractable) the exact same content
    detectors the prompt itself uses. Returns the tagged DetectionResults to
    fold into the overall scan plus a FileFindingSummary - including this
    file's OWN independent action/reason (see FileFindingSummary's
    docstring) - for audit/dashboard purposes AND for the extension to gate
    each file individually rather than all-or-nothing."""
    filename = file_input.filename
    extension = infer_extension(filename)
    category = get_file_category(filename)
    source_label = f"file:{filename}"

    file_results: list[DetectionResult] = []

    # 1. Org-level allow-list (services/settings_service.py -> OrgSettings.
    #    allowed_file_types) is checked FIRST and short-circuits extraction -
    #    an admin who has explicitly disallowed a file type shouldn't have
    #    its contents parsed at all, just rejected.
    if extension and extension not in allowed_extensions:
        file_results.append(assess_disallowed_extension(filename))
        extracted = False
        extraction_note = f"File type '.{extension}' is not in the organization's allowed file types."
    else:
        # 2. Identity risk (e.g. .env, private keys, docker-compose.yml) -
        #    independent of whether extraction below succeeds.
        identity_result = assess_file_identity_risk(filename)
        if identity_result.severity != Severity.NONE:
            file_results.append(identity_result)

        # 3. Content: extract text, then run it through the SAME detector
        #    pipeline as a typed prompt (no duplicated detection logic).
        extraction = extract_text_from_file(filename, file_input.content_base64)
        extracted = extraction.success and bool(extraction.text.strip())
        extraction_note = None if extraction.success else extraction.reason

        if extracted:
            file_normalized = normalize_prompt(extraction.text).normalized
            file_results.extend(_run_deterministic_detectors(file_normalized, keywords))
        elif not extraction.success:
            extraction_note = extraction.reason

    tagged = _tag_with_source(file_results, source_label)

    # Per-file decision: this file's OWN risk assessment, policy match, and
    # decision - computed from ONLY this file's findings, completely
    # independent of the prompt and every other file in the same request.
    # This is what lets a batch of five files upload the four clean ones
    # and hold back just the risky one, instead of one bad file vetoing the
    # whole batch. It never feeds into the overall Decision a second time
    # (that's computed once, over every result from prompt + all files
    # combined, in run_pipeline) - the two are deliberately separate:
    # the overall decision still gates the PROMPT TEXT (unified across
    # everything attached, per the original File Scanning spec), while this
    # per-file decision is what the extension acts on to gate each FILE.
    per_file_risk = assess_risk(file_results)
    per_file_policy_outcome = evaluate_policies(file_results, policies)
    per_file_decision = decide(per_file_risk, per_file_policy_outcome, file_results)

    size_bytes = file_input.size_bytes
    if size_bytes is None:
        # Fall back to the decoded size so audit logs always have a number
        # even if the extension client didn't send one.
        try:
            size_bytes = len(base64.b64decode(file_input.content_base64, validate=False))
        except Exception:
            size_bytes = None

    summary = FileFindingSummary(
        filename=filename,
        extension=extension or "",
        category=category,
        size_bytes=size_bytes,
        mime_type=file_input.mime_type,
        risk=per_file_risk.overall_severity.value,
        score=per_file_risk.overall_score,
        action=per_file_decision.action.value,
        reason=per_file_decision.reason,
        extracted=extracted,
        extraction_note=extraction_note,
    )

    return tagged, summary


def run_pipeline(db: Session, prompt: str, site: str, files: list[ScanFileInput]) -> PipelineOutput:
    normalized = normalize_prompt(prompt)
    text = normalized.normalized

    keywords = get_enabled_keywords(db)
    org_settings = get_or_create_settings(db)
    allowed_extensions = {ext.lower().lstrip(".") for ext in (org_settings.allowed_file_types or [])}
    # Fetched once, upfront, so both the per-file decisions below and the
    # overall decision at the end evaluate against the exact same policy
    # set for this request.
    policies = get_enabled_policies(db)

    all_results: list[DetectionResult] = list(_run_deterministic_detectors(text, keywords)) if text.strip() else []

    file_findings: list[FileFindingSummary] = []
    for file_input in files:
        tagged_results, summary = _scan_one_file(file_input, keywords, allowed_extensions, policies)
        all_results.extend(tagged_results)
        file_findings.append(summary)

    # OpenRouter Semantic Classifier - only when traditional detectors are
    # inconclusive. classify_semantic_risk() already fails open internally
    # (missing API key, network error, bad response all return a neutral
    # result - see semantic_classifier.py), but wrap it too for defense in
    # depth against a truly unexpected exception (e.g. a malformed response
    # body that survives its own try/except). Semantic classification only
    # ever runs over the prompt text itself, unchanged from before file
    # scanning existed.
    if text.strip() and should_run_semantic_classifier(all_results):
        all_results.append(_safe_call("semantic", lambda: classify_semantic_risk(text)))

    risk_assessment = assess_risk(all_results)
    policy_outcome = evaluate_policies(all_results, policies)
    decision = decide(risk_assessment, policy_outcome, all_results)

    from ai.redactor import redact_text

    # Redaction correctness: a DetectionResult's Match.start/end offsets are
    # only ever valid within the SPECIFIC text that produced them. File-
    # tagged results (reason prefixed "[file:...]" by _tag_with_source) hold
    # offsets into that file's own extracted text, not the prompt - passing
    # them to redact_text(text=prompt, ...) here would apply the wrong spans
    # to the wrong string. Only prompt-sourced results (plus the semantic
    # classifier, which never emits span offsets) are used to sanitize the
    # prompt; file content itself is never span-redacted (uploaded files are
    # gated by ALLOW/WARN/REDACT-as-warn/BLOCK on the whole file instead -
    # see the browser extension's file interception).
    prompt_sourced_results = [r for r in all_results if not r.reason.startswith("[file:")]
    sanitized_prompt = redact_text(text, prompt_sourced_results) if text.strip() else text

    return PipelineOutput(
        decision=decision,
        sanitized_prompt=sanitized_prompt,
        all_results=all_results,
        file_findings=file_findings,
    )
