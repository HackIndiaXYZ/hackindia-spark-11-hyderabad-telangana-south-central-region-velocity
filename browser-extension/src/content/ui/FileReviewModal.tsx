import { ModalShell } from "./ModalShell"
import { RiskAnalysisPanel } from "./RiskAnalysisPanel"
import type { RiskAnalysisView } from "./riskAnalysis"

interface FileReviewModalProps {
  analysis: RiskAnalysisView
  onDismiss: () => void
  /** null when there's nothing left to decide on - every flagged file was a
   * hard BLOCK, so this is purely informational. */
  onUploadFlagged: (() => void) | null
}

/**
 * Shown after a multi-file upload where at least one file wasn't a clean
 * ALLOW. Any file that scanned clean has ALREADY been uploaded by this
 * point (content/index.ts replays safe files immediately) - this modal is
 * only about the remainder, so the copy is deliberately different from the
 * single-prompt Warn/Block modals: it's reporting a partial outcome, not
 * gating everything on one answer.
 */
export function FileReviewModal({ analysis, onDismiss, onUploadFlagged }: FileReviewModalProps) {
  const hasBlockedOnly = onUploadFlagged === null

  return (
    <ModalShell
      tone={hasBlockedOnly ? "block" : "warn"}
      title={hasBlockedOnly ? "Some files were not uploaded" : "Some files need your review"}
      subtitle={
        hasBlockedOnly
          ? "Any clean files in your selection were uploaded already. The file(s) below violate your organization's policy and were not sent."
          : "Any clean files in your selection were uploaded already. Review the flagged file(s) below before deciding whether to send them too."
      }
      footer={
        hasBlockedOnly ? (
          <button onClick={onDismiss} className="ps-btn ps-btn-danger">
            Got it
          </button>
        ) : (
          <>
            <button onClick={onDismiss} className="ps-btn ps-btn-secondary">
              Skip These Files
            </button>
            <button onClick={onUploadFlagged} className="ps-btn ps-btn-warning">
              Upload Anyway
            </button>
          </>
        )
      }
    >
      <RiskAnalysisPanel analysis={analysis} />
    </ModalShell>
  )
}
