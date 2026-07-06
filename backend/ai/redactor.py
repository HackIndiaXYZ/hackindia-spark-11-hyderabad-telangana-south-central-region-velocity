"""
Prompt Redactor - replaces detected sensitive spans with readable
placeholders (e.g. [REDACTED_EMAIL]) rather than blanking them out, so a
redacted prompt still makes grammatical sense to the AI model on the other
end.

Only detectors that report exact character offsets (regex, Presidio,
spaCy, company keywords) can be span-redacted. The Secret Detector
intentionally never exposes raw secret values (only hashes) as a security
property, so secret findings are not span-redacted here - in practice this
is fine, because any prompt with a real secret is routed to BLOCK by the
Policy Engine rather than REDACT, so there's nothing left to sanitize.
"""
from schemas.detection import DetectionResult

_PLACEHOLDERS: dict[str, str] = {
    "EMAIL": "[REDACTED_EMAIL]",
    "EMAIL_ADDRESS": "[REDACTED_EMAIL]",
    "PHONE_NUMBER": "[REDACTED_PHONE]",
    "CREDIT_CARD": "[REDACTED_CREDIT_CARD]",
    "AWS_ACCESS_KEY": "[REDACTED_API_KEY]",
    "AWS_SECRET_KEY": "[REDACTED_API_KEY]",
    "GITHUB_TOKEN": "[REDACTED_API_KEY]",
    "GOOGLE_API_KEY": "[REDACTED_API_KEY]",
    "OPENAI_API_KEY": "[REDACTED_API_KEY]",
    "ANTHROPIC_API_KEY": "[REDACTED_API_KEY]",
    "HUGGINGFACE_TOKEN": "[REDACTED_API_KEY]",
    "REPLICATE_API_TOKEN": "[REDACTED_API_KEY]",
    "GROQ_API_KEY": "[REDACTED_API_KEY]",
    "PERPLEXITY_API_KEY": "[REDACTED_API_KEY]",
    "NOTION_API_KEY": "[REDACTED_API_KEY]",
    "SLACK_WEBHOOK_URL": "[REDACTED_WEBHOOK_URL]",
    "DISCORD_WEBHOOK_URL": "[REDACTED_WEBHOOK_URL]",
    "DB_CONNECTION_STRING": "[REDACTED_DB_CONNECTION_STRING]",
    "GENERIC_API_KEY": "[REDACTED_API_KEY]",
    "BEARER_TOKEN": "[REDACTED_API_KEY]",
    "JWT_TOKEN": "[REDACTED_API_KEY]",
    "PASSWORD": "[REDACTED_PASSWORD]",
    "PERSON": "[REDACTED_PERSON]",
    "LOCATION": "[REDACTED_LOCATION]",
    "ADDRESS": "[REDACTED_LOCATION]",
    "GPE": "[REDACTED_LOCATION]",
    "LOC": "[REDACTED_LOCATION]",
    "IP_ADDRESS": "[REDACTED_IP]",
    "US_SSN": "[REDACTED_SSN]",
    "US_PASSPORT": "[REDACTED_PASSPORT]",
    "IBAN_CODE": "[REDACTED_BANK_DETAILS]",
    "COMPANY_KEYWORD": "[REDACTED_CONFIDENTIAL]",
}


def redact_text(text: str, results: list[DetectionResult]) -> str:
    spans: list[tuple[int, int, str]] = []
    for result in results:
        for match in result.matches:
            if match.start is None or match.end is None:
                continue  # not span-redactable (e.g. secrets, source-code classification)
            placeholder = _PLACEHOLDERS.get(match.label, f"[REDACTED_{match.label}]")
            spans.append((match.start, match.end, placeholder))

    if not spans:
        return text

    # Resolve overlaps: keep the first-seen span per region, sorted by start.
    spans.sort(key=lambda s: (s[0], s[1]))
    resolved: list[tuple[int, int, str]] = []
    last_end = -1
    for start, end, placeholder in spans:
        if start < last_end:
            continue  # overlaps a previously kept span - skip
        resolved.append((start, end, placeholder))
        last_end = end

    # Apply replacements back-to-front so earlier offsets stay valid.
    result_text = text
    for start, end, placeholder in sorted(resolved, key=lambda s: s[0], reverse=True):
        result_text = result_text[:start] + placeholder + result_text[end:]

    return result_text
