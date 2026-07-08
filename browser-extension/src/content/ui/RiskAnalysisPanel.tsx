import { CheckCircle2, FileText, ShieldAlert, ShieldCheck } from "lucide-react"
import { ACTION_LABELS, RISK_COLORS } from "@/utils/labels"
import type { RiskAnalysisView } from "./riskAnalysis"

/**
 * The "Explainable AI" panel: instead of just saying BLOCK, this shows the
 * judges (and employees) exactly why - overall risk score, every finding
 * that fired, which policy (if any) made the call, and the reasoning.
 *
 * File Scanning: when one or more files were attached, their findings are
 * grouped into their own per-file cards (each with that file's OWN
 * action/risk badge) instead of one flattened list - so "which file had
 * what" is immediately clear when several files are scanned together. With
 * no attachments this renders exactly as it always has.
 */
export function RiskAnalysisPanel({ analysis }: { analysis: RiskAnalysisView }) {
  const riskColor = RISK_COLORS[analysis.risk] ?? RISK_COLORS.MEDIUM
  const hasFiles = analysis.fileGroups.length > 0

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

      {hasFiles && analysis.findings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</p>
          <FindingsList findings={analysis.findings} />
        </div>
      )}

      {!hasFiles && analysis.findings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Detected</p>
          <FindingsList findings={analysis.findings} />
        </div>
      )}

      {hasFiles && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Files ({analysis.fileGroups.length})
          </p>
          <div className="space-y-2">
            {analysis.fileGroups.map((group) => {
              const groupColor = RISK_COLORS[group.risk] ?? RISK_COLORS.NONE
              const isClean = group.action === "ALLOW"
              return (
                <div key={group.filename} className="rounded-md border border-border px-3 py-2" style={{ background: "var(--background)", isolation: "isolate" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={group.filename}>
                        {group.filename}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${groupColor}1a`, color: groupColor }}>
                      {isClean ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                      {ACTION_LABELS[group.action] ?? group.action}
                    </span>
                  </div>

                  {!group.extracted && group.extractionNote && (
                    <p className="mt-1 text-xs text-muted-foreground">{group.extractionNote}</p>
                  )}

                  {group.findings.length > 0 ? (
                    <div className="mt-2">
                      <FindingsList findings={group.findings} compact />
                    </div>
                  ) : isClean ? (
                    <p className="mt-1 text-xs text-success">No issues found in this file.</p>
                  ) : null}
                </div>
              )
            })}
          </div>
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

function FindingsList({ findings, compact }: { findings: RiskAnalysisView["findings"]; compact?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {findings.map((finding, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 rounded-md border border-border ${compact ? "px-2.5 py-1.5" : "px-3 py-2"}`}
          style={{ background: compact ? "var(--muted)" : "var(--background)", isolation: "isolate" }}
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="font-medium">{finding.title}</p>
            <p className="text-xs text-muted-foreground">{finding.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
