/**
 * Content script injected into ChatGPT, Claude, and Gemini.
 *
 * Intercepts submission (send-button click and Enter keydown), routes the
 * prompt through the background service worker to POST /api/scan, then
 * enforces whatever the backend decided:
 *
 *   ALLOW  -> let it through immediately, no UI, just a log entry.
 *   WARN   -> blocking modal with Cancel/Continue; only proceeds on Continue.
 *   REDACT -> sensitive text replaced in-place with placeholders; the user
 *             reviews and clicks Send again themselves (never auto-resent).
 *   BLOCK  -> blocking modal, submission is never sent to the site.
 *
 * File Scanning: this file ALSO intercepts file selection (file-picker
 * "change" events) and drag-and-drop ("drop" events) using the exact same
 * document-capture-phase trick as prompt interception below, so a file is
 * gated before the site's own attach/upload flow ever sees it. See the
 * "File upload interception" section near the bottom.
 *
 * This file contains zero detection logic - everything about *why* a
 * prompt or file was flagged comes from the backend's response and is
 * rendered by the Explainable AI panel (content/ui/RiskAnalysisPanel.tsx).
 */
import { getAdapterForHostname } from "@/adapters"
import { mountContentUI } from "@/content/ui/mount"
import { buildRiskAnalysis, type RiskAnalysisView } from "@/content/ui/riskAnalysis"
import { setState } from "@/content/ui/store"
import { MAX_FILES_PER_REQUEST, fileToBase64, partitionBySize, replayFilesAsDrop, replayFilesIntoInput } from "@/utils/files"
import type { ExtensionMessage, ScanFilePayload, ScanResult } from "@/types/messages"

const adapter = getAdapterForHostname(window.location.hostname)

if (adapter) {
  let bypassNextSubmit = false
  let isProcessing = false
  let currentInput: HTMLElement | null = null
  let currentSendButton: HTMLElement | null = null

  function attach(input: HTMLElement, sendButton: HTMLElement | null) {
    currentInput = input
    currentSendButton = sendButton
  }

  document.addEventListener(
    "click",
    (event) => {
      if (currentSendButton && event.target instanceof Node && currentSendButton.contains(event.target)) {
        void onIntercept(event)
      }
    },
    { capture: true }
  )
  document.addEventListener(
    "keydown",
    (event) => {
      if (currentInput && event.target instanceof Node && currentInput.contains(event.target)) {
        onKeydown(event as KeyboardEvent)
      }
    },
    { capture: true }
  )
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target
      if (
        form instanceof HTMLFormElement &&
        ((currentInput && form.contains(currentInput)) || (currentSendButton && form.contains(currentSendButton)))
      ) {
        void onIntercept(event)
      }
    },
    { capture: true }
  )

  let isProcessingFiles = false
  const bypassInputs = new WeakSet<HTMLInputElement>()
  let bypassNextDrop = false

  function clientSideRejection(message: string): RiskAnalysisView {
    return { risk: "CRITICAL", score: 0, action: "BLOCK", reason: message, triggeredPolicy: null, findings: [], fileGroups: [] }
  }

  interface FileGateActions {
    replay: (files: File[]) => void
    clear: () => void
  }

  async function handleFilesIntercepted(rawFiles: File[], actions: FileGateActions) {
    if (!adapter) {
      actions.replay(rawFiles)
      return
    }

    if (rawFiles.length > MAX_FILES_PER_REQUEST) {
      setState({
        type: "block",
        analysis: clientSideRejection(`You can attach up to ${MAX_FILES_PER_REQUEST} files at a time - please attach them in smaller batches.`),
      })
      actions.clear()
      return
    }

    const { ok: sizedFiles, rejected } = partitionBySize(rawFiles)
    if (rejected.length > 0) {
      setState({ type: "block", analysis: clientSideRejection(rejected.map((r) => r.reason).join(" ")) })
      actions.clear()
      return
    }

    if (isProcessingFiles) {
      actions.replay(sizedFiles)
      return
    }

    isProcessingFiles = true
    try {
      const encoded: ScanFilePayload[] = await Promise.all(
        sizedFiles.map(async (file) => ({
          filename: file.name,
          contentBase64: await fileToBase64(file),
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        }))
      )

      const prompt = adapter && currentInput ? adapter.getPromptText(currentInput) : ""

      let result: ScanResult
      try {
        result = await sendScanMessage(prompt, adapter.siteName, encoded)
      } catch (err) {
        console.error("[PromptShield AI] File scan request failed - allowing files through (fail open).", err)
        actions.replay(sizedFiles)
        return
      }

      logActivity(result.decision)

      const fileFindings = result.file_findings ?? []
      const byFilename = new Map(sizedFiles.map((file) => [file.name, file]))
      const safeFiles: File[] = []
      const flaggedFiles: File[] = []
      const blockedFiles: File[] = []

      for (const finding of fileFindings) {
        const file = byFilename.get(finding.filename)
        if (!file) continue
        if (finding.action === "BLOCK") blockedFiles.push(file)
        else if (finding.action === "WARN" || finding.action === "REDACT") flaggedFiles.push(file)
        else safeFiles.push(file)
      }
      for (const file of sizedFiles) {
        if (!fileFindings.some((finding) => finding.filename === file.name)) safeFiles.push(file)
      }

      if (safeFiles.length > 0) actions.replay(safeFiles)

      if (flaggedFiles.length === 0 && blockedFiles.length === 0) {
        return
      }

      setState({
        type: "file-review",
        analysis: buildRiskAnalysis(result),
        onDismiss: () => {
          /* flagged/blocked files simply aren't uploaded */
        },
        onUploadFlagged: flaggedFiles.length > 0 ? () => actions.replay(flaggedFiles) : null,
      })
    } finally {
      isProcessingFiles = false
    }
  }

  function handleFileInputChange(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== "file") return

    if (bypassInputs.has(target)) {
      bypassInputs.delete(target)
      return
    }

    const files = Array.from(target.files ?? [])
    if (files.length === 0) return

    event.stopImmediatePropagation()
    void handleFilesIntercepted(files, {
      replay: (filesToReplay) => {
        if (filesToReplay.length === 0) {
          target.value = ""
          return
        }
        bypassInputs.add(target)
        replayFilesIntoInput(target, filesToReplay)
      },
      clear: () => {
        target.value = ""
      },
    })
  }

  function handleDrop(event: DragEvent) {
    if (bypassNextDrop) {
      bypassNextDrop = false
      return
    }

    const files = event.dataTransfer ? Array.from(event.dataTransfer.files ?? []) : []
    if (files.length === 0) return

    event.preventDefault()
    event.stopImmediatePropagation()
    void handleFilesIntercepted(files, {
      replay: (filesToReplay) => {
        if (filesToReplay.length === 0) return
        bypassNextDrop = true
        replayFilesAsDrop(filesToReplay, event)
      },
      clear: () => {
        // Nothing to clear.
      },
    })
  }

  document.addEventListener("change", handleFileInputChange, { capture: true })
  document.addEventListener("drop", handleDrop, { capture: true })

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      void onIntercept(event)
    }
  }

  async function onIntercept(event: Event) {
    if (bypassNextSubmit) {
      bypassNextSubmit = false
      return
    }
    if (!adapter || !currentInput || isProcessing) return

    const prompt = adapter.getPromptText(currentInput)
    if (!prompt.trim()) return

    event.preventDefault()
    event.stopImmediatePropagation()

    isProcessing = true
    try {
      const result = await sendScanMessage(prompt, adapter.siteName)
      handleDecision(result)
    } catch (err) {
      console.error("[PromptShield AI] Scan request failed - allowing prompt through (fail open).", err)
      resubmit()
    } finally {
      isProcessing = false
    }
  }

  function sendScanMessage(prompt: string, site: string, files: ScanFilePayload[] = []): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const message: ExtensionMessage = { type: "SCAN_PROMPT", payload: { prompt, site, files } }
      chrome.runtime.sendMessage(message, (result: ScanResult) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve(result)
      })
    })
  }

  function handleDecision(result: ScanResult) {
    if (!adapter || !currentInput) return
    logActivity(result.decision)

    if (result.decision === "BLOCK") {
      setState({ type: "block", analysis: buildRiskAnalysis(result) })
      return
    }

    if (result.decision === "REDACT") {
      adapter.replacePrompt(currentInput, result.sanitized_prompt)
      setState({
        type: "redact-toast",
        message: "Review the updated prompt, then click Send again when you're ready.",
      })
      return
    }

    if (result.decision === "WARN") {
      setState({
        type: "warn",
        analysis: buildRiskAnalysis(result),
        onCancel: () => {
          /* leave the prompt exactly as the employee wrote it - nothing sent */
        },
        onContinue: () => resubmit(),
      })
      return
    }

    resubmit()
  }

  function logActivity(decision: ScanResult["decision"]) {
    if (!adapter) return
    chrome.runtime.sendMessage({
      type: "LOG_ACTIVITY",
      payload: { site: adapter.siteName, decision },
    } satisfies ExtensionMessage)
  }

  function resubmit() {
    bypassNextSubmit = true
    if (currentSendButton) {
      currentSendButton.click()
    } else if (currentInput) {
      currentInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      )
    }
  }

  function start() {
    if (!adapter) return
    void mountContentUI()
    adapter.observeDOM((input, sendButton) => attach(input, sendButton))
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start)
  } else {
    start()
  }
}
