/**
 * Builds the "Explainable AI" view model from a ScanResult - the same
 * response object the backend already returns from POST /api/scan. No
 * backend changes; this is purely a presentation-layer transformation.
 *
 * File Scanning: findings are grouped per source file rather than shown as
 * one flat list, so when several files are attached and (say) two of them
 * each contain a different secret, the panel shows "which file had what"
 * instead of a jumbled combined list. Each file group also carries that
 * file's OWN action/risk (see FileFinding.action in types/messages.ts) -
 * independent of every other file - since that's what actually determines
 * whether it gets uploaded (content/index.ts) versus this view's top-level
 * risk/action, which stays the unified prompt+all-files verdict.
 */
import { extractTriggeredPolicy, friendlyDetectorName, splitFileSource } from "@/utils/labels"
import type { Decision, FileFinding, ScanResult } from "@/types/messages"

export interface RiskFindingView {
  title: string
  detail: string
  source: string | null
}

export interface FileRiskGroup {
  filename: string
  risk: string
  score: number
  action: Decision
  extracted: boolean
  extractionNote: string | null
  findings: RiskFindingView[]
}

export interface RiskAnalysisView {
  risk: string
  score: number
  action: string
  reason: string
  triggeredPolicy: string | null
  // Findings with no file source (i.e. came from the prompt text itself).
  // When fileGroups is non-empty, the panel renders this under a "Prompt"
  // heading; when it's empty (the common no-attachments case), this is
  // rendered exactly as it always has been - a single flat list.
  findings: RiskFindingView[]
  fileGroups: FileRiskGroup[]
}

export function buildRiskAnalysis(result: ScanResult): RiskAnalysisView {
  const allFindings: RiskFindingView[] = (result.findings ?? []).map((f) => {
    const { source, text } = splitFileSource(f.reason)
    return {
      title: friendlyDetectorName(f.detector),
      detail: text,
      source,
    }
  })

  const promptFindings = allFindings.filter((f) => f.source === null)

  const fileFindings: FileFinding[] = result.file_findings ?? []
  const fileGroups: FileRiskGroup[] = fileFindings.map((ff) => ({
    filename: ff.filename,
    risk: ff.risk,
    score: ff.score,
    action: ff.action,
    extracted: ff.extracted,
    extractionNote: ff.extraction_note,
    findings: allFindings.filter((f) => f.source === ff.filename),
  }))

  return {
    risk: result.risk ?? "MEDIUM",
    score: result.score ?? 0,
    action: result.decision,
    reason: result.reason ?? "This prompt was flagged by PromptShield AI.",
    triggeredPolicy: result.reason ? extractTriggeredPolicy(result.reason) : null,
    findings: promptFindings,
    fileGroups,
  }
}
