"""Pydantic schemas for POST /api/scan - the primary API the extension calls."""
from pydantic import BaseModel, Field, field_validator, model_validator

# Milestone 6 hardening: the original schema had no cap on file count or
# attachment size, so a caller (or a compromised/buggy extension build)
# could send an arbitrarily large base64 payload and exhaust server memory
# decoding it - a simple, cheap DoS. These limits mirror what a real
# ChatGPT/Claude/Gemini attachment upload would realistically be.
MAX_FILES_PER_SCAN = 5
MAX_FILE_BASE64_LENGTH = 14_000_000  # ~10MB decoded (base64 is ~4/3 the size)


class ScanFileInput(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_base64: str = Field(..., max_length=MAX_FILE_BASE64_LENGTH)
    # Both additive/optional - the browser extension supplies mime_type from
    # the File object and size from its byte length when available, but
    # neither is required (size can always be derived from the decoded
    # base64 length, and mime_type is only used for audit-log context, never
    # for detection - detection always goes by the filename's extension).
    mime_type: str | None = None
    size_bytes: int | None = Field(None, ge=0)

    @field_validator("filename")
    @classmethod
    def filename_no_path_traversal(cls, v: str) -> str:
        # Filenames only ever need to be a display label - never resolved to
        # a real path anywhere in this codebase - but stripping directory
        # components defensively costs nothing and rules out an entire class
        # of confusion if that ever changes.
        return v.replace("\\", "/").rsplit("/", 1)[-1]


class ScanRequest(BaseModel):
    # Milestone: File Scanning - a request may now be prompt-only (existing
    # behavior, unchanged), files-only, or both. `prompt` is no longer
    # required on its own; the model_validator below enforces that at least
    # ONE of prompt/files is present so an empty request still can't slip
    # through.
    prompt: str = Field("", max_length=50_000)
    site: str = Field(..., description="ChatGPT | Claude | Gemini")
    files: list[ScanFileInput] = Field(default_factory=list, max_length=MAX_FILES_PER_SCAN)

    @field_validator("site")
    @classmethod
    def site_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("site must not be blank")
        return v

    @model_validator(mode="after")
    def prompt_or_files_required(self) -> "ScanRequest":
        if not self.prompt.strip() and not self.files:
            raise ValueError("Request must include a non-empty prompt, at least one file, or both.")
        return self


class TriggeredRule(BaseModel):
    detector: str
    severity: str
    score: int
    reason: str


class FileFindingSummary(BaseModel):
    """Per-file rollup surfaced to the extension/dashboard - additive to the
    Milestone 1 response contract, never required by existing callers.

    `action`/`reason` are this file's OWN decision, computed independently
    from every other file and from the prompt (see ai/pipeline.py
    _scan_one_file) - this is what lets the extension upload the safe files
    in a multi-file batch while only holding back the risky ones, instead
    of one bad file vetoing the entire batch. The top-level ScanResponse's
    decision/reason remain the UNIFIED prompt+all-files verdict (still used
    to redact/gate the prompt text itself); this per-file action is what
    the extension should use to decide whether to actually let a given
    FILE through."""

    filename: str
    extension: str
    category: str  # document | source_code | configuration | data | logs | image | unknown
    size_bytes: int | None
    mime_type: str | None
    risk: str  # NONE | LOW | MEDIUM | HIGH | CRITICAL (highest severity this file contributed)
    score: int  # this file's own aggregate score (its findings only)
    action: str  # ALLOW | WARN | REDACT | BLOCK - this file's own decision
    reason: str  # why - this file's own top finding or triggered policy
    extracted: bool  # whether text extraction succeeded for this file
    extraction_note: str | None  # why extraction failed/was skipped, if applicable


class ScanResponse(BaseModel):
    # Field names kept stable from Milestone 1's extension contract
    # (decision / sanitized_prompt / findings) so the extension needs no
    # logic changes - only its request URL changes. risk/score/reason are
    # additive fields for the (future) Prompt Logs / Analytics dashboard.
    decision: str  # ALLOW | WARN | REDACT | BLOCK
    risk: str  # LOW | MEDIUM | HIGH | CRITICAL
    score: int
    reason: str
    sanitized_prompt: str
    findings: list[TriggeredRule] = []
    # File Scanning: additive, defaults to [] so nothing that only reads the
    # Milestone 1/2 fields above needs to change.
    file_findings: list[FileFindingSummary] = []
