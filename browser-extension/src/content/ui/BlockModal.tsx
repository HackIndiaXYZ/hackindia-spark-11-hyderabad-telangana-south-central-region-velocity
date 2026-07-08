import { ModalShell } from "./ModalShell"
import { RiskAnalysisPanel } from "./RiskAnalysisPanel"
import type { RiskAnalysisView } from "./riskAnalysis"

interface BlockModalProps {
  analysis: RiskAnalysisView
  onDismiss: () => void
}

export function BlockModal({ analysis, onDismiss }: BlockModalProps) {
  return (
    <ModalShell
      tone="block"
      title="Prompt Blocked"
      subtitle="This prompt was not sent - it violates your organization's AI usage policy."
      footer={
        <button onClick={onDismiss} className="ps-btn ps-btn-danger">
          Edit Prompt
        </button>
      }
    >
      <RiskAnalysisPanel analysis={analysis} />
    </ModalShell>
  )
}
