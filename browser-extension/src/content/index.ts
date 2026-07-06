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
 * This file contains zero detection logic - everything about *why* a
 * prompt was flagged comes from the backend's response and is rendered by
 * the Explainable AI panel (content/ui/RiskAnalysisPanel.tsx).
 */
import { getAdapterForHostname } from "@/adapters"
import { mountContentUI } from "@/content/ui/mount"
import { buildRiskAnalysis } from "@/content/ui/riskAnalysis"
import { setState } from "@/content/ui/store"
import type { ExtensionMessage, ScanResult } from "@/types/messages"

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

  // Bound once, on `document` - not on the site's own button/input elements
  // - AND as early as possible: manifest.json runs this content script at
  // "document_start" specifically so these lines execute BEFORE the page's
  // own JavaScript has booted. Two separate race conditions matter here:
  //
  //  1. DOM depth: ChatGPT/Claude/Gemini are React/Angular SPAs whose
  //     framework attaches its OWN handler at (or near) its root container,
  //     an ancestor of the send button. During the native capture phase,
  //     ancestors fire before descendants, so a listener on the button
  //     itself always loses - the framework's send logic fires first, the
  //     message goes out, and only then does our preventDefault() run (too
  //     late). `document` is the outermost ancestor of everything,
  //     including the framework's own root, so binding here wins on depth
  //     alone.
  //  2. Registration order: for two listeners on the SAME node in the SAME
  //     phase, whichever was added first runs first - depth doesn't help
  //     there. If the page itself ever attaches something at the
  //     document/window level (global keyboard shortcuts, etc.), running
  //     at "document_idle" would mean the page's own script already booted
  //     and registered first, beating us. "document_start" guarantees we
  //     register before the page's own script has even begun executing.
  //
  // Registering here doesn't need the DOM to be ready - `document` is a
  // valid EventTarget from the very first instant, even before <body>
  // exists. Only the UI mount and composer watcher below need to wait for
  // an actual DOM to attach to.
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
  // Some sites' composers are wrapped in a real <form> (chatgpt.ts's own
  // selectors reference `form button[type="submit"]`), and the send action
  // fires via the form's native "submit" event rather than a click handler.
  // Catch that path too, same document-capture-wins-the-race reasoning.
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

    // Always intercept first - we decide whether to let it through once the
    // backend responds. This is a firm "fail closed until proven safe" for
    // the interception itself, even though the backend fails OPEN on error
    // (see the catch block below) so a backend outage never traps an
    // employee's work indefinitely.
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

  function sendScanMessage(prompt: string, site: string): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const message: ExtensionMessage = { type: "SCAN_PROMPT", payload: { prompt, site } }
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

    // ALLOW - no popup, just let it through.
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

  // document.body (and often document.documentElement's full subtree) may
  // not exist yet at "document_start" - mounting our Shadow DOM host and
  // starting the MutationObserver both need a real DOM to attach to, so
  // defer just these two calls until the document is actually ready. The
  // interception listeners above are already live well before this point.
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
