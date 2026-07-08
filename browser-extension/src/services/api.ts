/**
 * Backend client used by the background service worker. Runs outside any
 * page's CSP, so plain fetch() against the configured API base URL is safe.
 */
import type { AuthUser, ScanFilePayload, ScanResult } from "@/types/messages"

export const API_BASE_URL = "http://localhost:8000"

interface LoginResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

/** Retries only network-level failures (offline, DNS, timeout) - never retries a response the server actually sent. */
async function fetchWithRetry(input: string, init: RequestInit, attempts = 3, baseDelayMs = 400): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(input, init)
    } catch (err) {
      lastError = err
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
      }
    }
  }
  throw lastError
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? "Login failed")
  }
  return res.json()
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Session expired")
  return res.json()
}

/** Lightweight connectivity probe backing the popup's "Backend Status" indicator. */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Thrown specifically for a 401 from /api/scan, so the background worker
 * can tell "your session expired" apart from "the backend is down" or
 * "the request was malformed" - see the SCAN_PROMPT handler in
 * background/index.ts, which clears the stored session on this error.
 */
export class ScanUnauthorizedError extends Error {
  constructor() {
    super("Session expired or invalid")
    this.name = "ScanUnauthorizedError"
  }
}

/**
 * Milestone 2: backed by the full AI Detection Engine (regex -> Presidio ->
 * spaCy -> source-code -> company-keyword -> secrets -> optional semantic
 * classifier -> risk engine -> policy engine -> decision engine ->
 * redactor). The response shape is unchanged from the Milestone 1 stub
 * (decision / sanitized_prompt / findings), so no other extension code
 * needed to change - only this URL.
 *
 * Milestone 3: retries transient network failures (offline blips, slow
 * wake-from-sleep) with backoff before failing open. A prompt should never
 * get permanently stuck because of a flaky connection - and a response the
 * server actually sent (e.g. a 4xx) is never retried, only failed open.
 *
 * Milestone 6 hardening: this used to fail open (ALLOW, unscanned) on
 * *any* non-2xx response, including 401 - meaning an expired or revoked
 * session silently meant "no protection at all" until the employee
 * happened to open the popup and notice. A 401 specifically now throws
 * ScanUnauthorizedError instead of swallowing it, so the background
 * worker can clear the stale session and the popup can prompt a clean
 * re-login. The prompt for THIS call still gets to go through (see the
 * SCAN_PROMPT handler) - failing open never gets undone, only the silent
 * "everything is fine" part does.
 *
 * File Scanning: `files` is optional and additive - a prompt-only call
 * (the original signature's every existing caller) sends no `files` key
 * at all, so the backend's ScanRequest sees exactly the same body shape
 * it always has. When files ARE attached (content/index.ts's file
 * interception), they're base64-encoded client-side and sent alongside
 * the prompt so the backend can compute one unified decision - see
 * ai/pipeline.py.
 */
export async function scanPrompt(
  token: string | null,
  prompt: string,
  site: string,
  files: ScanFilePayload[] = []
): Promise<ScanResult> {
  const res = await fetchWithRetry(`${API_BASE_URL}/api/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      prompt,
      site,
      ...(files.length > 0
        ? {
            files: files.map((f) => ({
              filename: f.filename,
              content_base64: f.contentBase64,
              mime_type: f.mimeType,
              size_bytes: f.sizeBytes,
            })),
          }
        : {}),
    }),
    // File uploads can legitimately take longer to scan (extraction +
    // running every detector over potentially several files) than a plain
    // text prompt - a fixed 15s budget that's fine for text alone risks
    // spuriously failing open on a large but perfectly legitimate batch of
    // attachments. Scale the timeout with file count, capped well below
    // where a user would assume the site itself has hung.
    signal: AbortSignal.timeout(files.length > 0 ? 30000 : 15000),
  }).catch(() => null)

  if (res === null) {
    // Backend unreachable even after retries - fail open with ALLOW so a
    // backend outage never blocks an employee's work. The popup's
    // "Backend Status" indicator (GET_BACKEND_STATUS) is what surfaces the
    // outage, not a stuck prompt.
    return { decision: "ALLOW", sanitized_prompt: prompt, findings: [] }
  }

  if (res.status === 401) {
    throw new ScanUnauthorizedError()
  }

  if (!res.ok) {
    return { decision: "ALLOW", sanitized_prompt: prompt, findings: [] }
  }
  return await res.json()
}
