/**
 * Message contract shared between popup, content scripts, and the
 * background service worker. Kept as a single source of truth so all
 * three surfaces speak the same protocol.
 */
export type Decision = "ALLOW" | "WARN" | "REDACT" | "BLOCK"

export interface ScanFinding {
  detector: string
  severity: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  score: number
  reason: string
}

/**
 * A file captured by the content script's file-picker/drag-and-drop
 * interception (see content/index.ts), ready to send to POST /api/scan
 * alongside (or instead of) the prompt. `contentBase64` mirrors the
 * backend's ScanFileInput.content_base64 field name in spirit but stays
 * camelCase on this side of the wire per the existing TS convention -
 * services/api.ts maps it to the snake_case body the backend expects.
 */
export interface ScanFilePayload {
  filename: string
  contentBase64: string
  mimeType?: string
  sizeBytes: number
}

export interface FileFinding {
  filename: string
  extension: string
  category: string
  size_bytes: number | null
  mime_type: string | null
  risk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  score: number
  // This file's OWN decision - computed independently from every other
  // file and from the prompt (backend: ai/pipeline.py _scan_one_file).
  // This is what content/index.ts gates individual file uploads on,
  // instead of the top-level ScanResult.decision, which is the unified
  // prompt+all-files verdict used only to redact/gate the prompt text.
  action: Decision
  reason: string
  extracted: boolean
  extraction_note: string | null
}

export interface ScanResult {
  decision: Decision
  // Added in Milestone 2 (AI Detection Engine) - populated by the Risk
  // Engine / Decision Engine. Optional so any older cached background
  // worker response still type-checks during rollout.
  risk?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  score?: number
  reason?: string
  sanitized_prompt: string
  findings: ScanFinding[]
  // File Scanning - additive, defaults to [] on responses with no
  // attachments so existing prompt-only call sites never need to change.
  file_findings?: FileFinding[]
}

export interface AuthUser {
  id: string
  email: string
  full_name: string
  role: string
}

export type ExtensionMessage =
  | { type: "SCAN_PROMPT"; payload: { prompt: string; site: string; files?: ScanFilePayload[] } }
  | { type: "LOGIN"; payload: { email: string; password: string } }
  | { type: "LOGOUT" }
  | { type: "GET_AUTH_STATE" }
  | { type: "LOG_ACTIVITY"; payload: { site: string; decision: Decision } }
  | { type: "GET_BACKEND_STATUS" }
  | { type: "GET_PROTECTION_ENABLED" }
  | { type: "SET_PROTECTION_ENABLED"; payload: { enabled: boolean } }
  | { type: "GET_LAST_SCAN" }

export interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
}

export interface BackendStatus {
  online: boolean
  lastCheckedAt: number | null
}

export interface LastScan {
  site: string
  decision: Decision
  at: number
}
