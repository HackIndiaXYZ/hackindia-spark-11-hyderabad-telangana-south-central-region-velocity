import { ModalShell } from "./ModalShell"
import { RiskAnalysisPanel } from "./RiskAnalysisPanel"
import type { RiskAnalysisView } from "./riskAnalysis"

interface WarnModalProps {
  analysis: RiskAnalysisView
  onCancel: () => void
  onContinue: () => void
}

export function WarnModal({ analysis, onCancel, onContinue }: WarnModalProps) {
  return (
    <ModalShell
      tone="warn"
      title="Prompt contains sensitive information"
      subtitle="Review the details below before sending."
      footer={
        <>
          <button onClick={onCancel} className="ps-btn ps-btn-secondary">
            Cancel
          </button>
          <button onClick={onContinue} className="ps-btn ps-btn-warning">
            Continue Anyway
          </button>
        </>
      }
    >
      <RiskAnalysisPanel analysis={analysis} />
    </ModalShell>
  )
}
