import { CheckCircle2, FileText, ShieldAlert } from "lucide-react"
import { ACTION_LABELS, RISK_COLORS } from "@/utils/labels"
import type { RiskAnalysisView } from "./riskAnalysis"

/**
 * The "Explainable AI" panel: instead of just saying BLOCK, this shows the
 * judges (and employees) exactly why - overall risk score, every finding
 * that fired, which policy (if any) made the call, and the reasoning.
 */
export function RiskAnalysisPanel({ analysis }: { analysis: RiskAnalysisView }) {
  const riskColor = RISK_COLORS[analysis.risk] ?? RISK_COLORS.MEDIUM

  return (
    <div className="space-y-4 text-sm">
      <div
        className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
        style={{ background: "var(--muted)", isolation: "isolate" }}
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall Risk</p>
          <p className="mt-0.5 text-lg font-semibold" style={{ color: riskColor }}>
            {analysis.risk} <span className="text-sm font-normal text-muted-foreground">({analysis.score}/100)</span>
          </p>
        </div>
        <div className="h-12 w-12 shrink-0 rounded-full" style={{ background: `conic-gradient(${riskColor} ${analysis.score * 3.6}deg, var(--muted) 0deg)` }}>
          <div
            className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-semibold"
            style={{ margin: 3, width: "calc(100% - 6px)", height: "calc(100% - 6px)", background: "var(--card)" }}
          >
            {analysis.score}
          </div>
        </div>
      </div>

      {analysis.findings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Detected</p>
          <ul className="space-y-1.5">
            {analysis.findings.map((finding, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
                style={{ background: "var(--background)", isolation: "isolate" }}
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0">
                  <p className="font-medium">{finding.title}</p>
                  <p className="text-xs text-muted-foreground">{finding.detail}</p>
                  {finding.source && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <FileText className="h-3 w-3" /> {finding.source}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.triggeredPolicy && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Triggered Policy</p>
          <div
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            style={{ background: "var(--background)", isolation: "isolate" }}
          >
            <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
            <span className="font-medium">{analysis.triggeredPolicy}</span>
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended Action</p>
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {ACTION_LABELS[analysis.action] ?? analysis.action}
        </span>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reason</p>
        <p className="text-sm leading-relaxed text-foreground">{analysis.reason}</p>
      </div>
    </div>
  )
}
