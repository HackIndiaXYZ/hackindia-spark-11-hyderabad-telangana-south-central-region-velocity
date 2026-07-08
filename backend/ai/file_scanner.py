"""
File Scanner - extracts plain text from uploaded files so it can be run
through EXACTLY the same detector pipeline as a typed prompt (no separate
detection logic is duplicated here; this module's only job is text
extraction + light classification of *what kind* of file this is).

Supported formats:
  Documents      - pdf, txt, docx
  Source Code    - java, py, js, jsx, ts, tsx, cpp, cc, cxx, h, hpp, c, cs,
                    go, rs, php, html, htm, css, sql
  Configuration  - env, properties, yaml, yml (incl. docker-compose.yml),
                    json, xml
  Data           - csv, xlsx
  Logs           - log
  Images (OCR)   - png, jpg, jpeg

Adding a new format only requires one entry in EXTRACTORS (and, if it's a
new *category* rather than just another plain-text type, one entry in
FILE_CATEGORIES) - nothing else in the pipeline needs to change. Image OCR
requires the system `tesseract` binary (apt-get install tesseract-ocr) - if
it's missing, extraction fails gracefully with a clear reason instead of
crashing the scan.
"""
import base64
import csv
import io
import logging
from typing import Callable

logger = logging.getLogger("promptshield.ai.file_scanner")

# --- Category registry -----------------------------------------------------
# Purely descriptive (used for audit logs, dashboard stats, and by
# ai/file_risk.py to reason about a file's identity) - has no bearing on
# extraction itself.
FILE_CATEGORIES: dict[str, str] = {
    # Documents
    "pdf": "document", "txt": "document", "docx": "document",
    # Source code
    "java": "source_code", "py": "source_code", "js": "source_code", "jsx": "source_code",
    "ts": "source_code", "tsx": "source_code", "cpp": "source_code", "cc": "source_code",
    "cxx": "source_code", "h": "source_code", "hpp": "source_code", "c": "source_code",
    "cs": "source_code", "go": "source_code", "rs": "source_code", "php": "source_code",
    "html": "source_code", "htm": "source_code", "css": "source_code", "sql": "source_code",
    # Configuration
    "env": "configuration", "properties": "configuration", "yaml": "configuration",
    "yml": "configuration", "json": "configuration", "xml": "configuration",
    # Data
    "csv": "data", "xlsx": "data",
    # Logs
    "log": "logs",
    # Images
    "png": "image", "jpg": "image", "jpeg": "image",
}

# Extensions with no meaningful "extension" at all (dotfiles like `.env` are
# handled fine by the normal filename.rsplit(".", 1) split - "example.env"
# -> "env" - but a bare ".env" with nothing before the dot needs its own
# case, see _infer_extension below).
_DOTFILE_EXTENSIONS = {"env"}


def infer_extension(filename: str) -> str:
    name = filename.strip()
    if "." not in name:
        return ""
    stem, _, ext = name.rpartition(".")
    ext = ext.lower()
    # A bare dotfile like ".env" (stem == "") is still meaningfully "env",
    # not an extension-less file.
    if stem == "" and ext:
        return ext
    return ext


SUPPORTED_EXTENSIONS = set(FILE_CATEGORIES.keys())


class FileExtractionResult:
    def __init__(self, filename: str, text: str, success: bool, reason: str = ""):
        self.filename = filename
        self.text = text
        self.success = success
        self.reason = reason


def _extract_plain_text(raw: bytes) -> str:
    """Shared extractor for every source-code/config/log extension - they're
    all just UTF-8 (or best-effort-decoded) text, fed into the SAME
    detectors as everything else. No per-language parsing is needed because
    detection happens on the text content, not the syntax tree."""
    return raw.decode("utf-8", errors="ignore")


def _extract_pdf(raw: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(raw: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(raw))
    return "\n".join(p.text for p in document.paragraphs)


def _extract_csv(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="ignore")
    reader = csv.reader(io.StringIO(text))
    return "\n".join(", ".join(row) for row in reader)


def _extract_xlsx(raw: bytes) -> str:
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    lines = []
    for sheet in workbook.worksheets:
        for row in sheet.iter_rows(values_only=True):
            values = [str(cell) for cell in row if cell is not None]
            if values:
                lines.append(", ".join(values))
    return "\n".join(lines)


def _extract_image_ocr(raw: bytes) -> str:
    import pytesseract
    from PIL import Image

    image = Image.open(io.BytesIO(raw))
    return pytesseract.image_to_string(image)


# extension -> extractor(raw_bytes) -> text. Every source-code/config/log
# extension shares _extract_plain_text since they need no special parsing -
# only pdf/docx/csv/xlsx/image formats need a real parser.
_PLAIN_TEXT_EXTENSIONS = {
    "java", "py", "js", "jsx", "ts", "tsx", "cpp", "cc", "cxx", "h", "hpp", "c", "cs",
    "go", "rs", "php", "html", "htm", "css", "sql",
    "env", "properties", "yaml", "yml", "json", "xml",
    "log", "txt",
}

EXTRACTORS: dict[str, Callable[[bytes], str]] = {
    **{ext: _extract_plain_text for ext in _PLAIN_TEXT_EXTENSIONS},
    "pdf": _extract_pdf,
    "docx": _extract_docx,
    "csv": _extract_csv,
    "xlsx": _extract_xlsx,
    "png": _extract_image_ocr,
    "jpg": _extract_image_ocr,
    "jpeg": _extract_image_ocr,
}


def get_file_category(filename: str) -> str:
    """Best-effort category for a filename, used even for unsupported
    extensions (falls back to "unknown") so audit logs / dashboard stats
    always have something sensible to group by."""
    return FILE_CATEGORIES.get(infer_extension(filename), "unknown")


def extract_text_from_file(filename: str, content_base64: str) -> FileExtractionResult:
    extension = infer_extension(filename)

    if extension not in EXTRACTORS:
        return FileExtractionResult(filename, "", False, f"Unsupported file type: .{extension}" if extension else "Unsupported file type: (no extension)")

    try:
        raw = base64.b64decode(content_base64, validate=False)
    except Exception as exc:
        return FileExtractionResult(filename, "", False, f"Invalid base64 content: {exc}")

    try:
        text = EXTRACTORS[extension](raw)
    except Exception as exc:
        logger.warning("Failed to extract text from %s: %s", filename, exc)
        return FileExtractionResult(filename, "", False, f"Extraction failed: {exc}")

    return FileExtractionResult(filename, text.strip(), True)
