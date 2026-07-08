/**
 * Minimal external store for the content-script UI. A single React root is
 * mounted once per page (see mount.tsx); everything else - showing a WARN
 * modal, a BLOCK modal, or a REDACT toast - just calls into this store, and
 * App.tsx re-renders via useSyncExternalStore. Keeps the imperative
 * interception logic in content/index.ts decoupled from React.
 */
import type { RiskAnalysisView } from "./riskAnalysis"

export type UIState =
  | { type: "idle" }
  | { type: "warn"; analysis: RiskAnalysisView; onCancel: () => void; onContinue: () => void }
  | { type: "block"; analysis: RiskAnalysisView }
  | { type: "redact-toast"; message: string }
  // File Scanning: shown after a multi-file batch where at least one file
  // wasn't a clean ALLOW. Any file that WAS clean has already been
  // uploaded by the time this appears (see content/index.ts) - this is
  // purely reviewing/deciding on the remainder, never holding the safe
  // files hostage. `onUploadFlagged` is null when there's nothing left to
  // decide on (every non-clean file was a hard BLOCK), in which case this
  // is just an informational summary with a single dismiss action.
  | {
      type: "file-review"
      analysis: RiskAnalysisView
      onDismiss: () => void
      onUploadFlagged: (() => void) | null
    }

let state: UIState = { type: "idle" }
const listeners = new Set<() => void>()

export function getState(): UIState {
  return state
}

export function setState(next: UIState): void {
  state = next
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dismiss(): void {
  setState({ type: "idle" })
}
