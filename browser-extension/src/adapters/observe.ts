/**
 * Shared DOM-watching logic used by every adapter (kept in one place per
 * "don't duplicate detection logic" - each adapter only supplies its own
 * selectors). Combines three redundant strategies, since these are
 * React/Angular SPAs that can remount the composer without a full
 * navigation:
 *
 *  1. MutationObserver on <body> - catches virtually all DOM changes.
 *  2. A cheap 1.5s poll - safety net for the rare mutation a observer misses.
 *  3. history.pushState/replaceState + popstate hooks - SPA route changes
 *     (e.g. opening a new chat) don't always trigger a body mutation
 *     immediately, so we explicitly re-check right after navigation.
 */
let historyPatched = false
const navigationListeners = new Set<() => void>()

function patchHistoryOnce() {
  if (historyPatched) return
  historyPatched = true

  const fire = () => navigationListeners.forEach((cb) => cb())

  const originalPushState = history.pushState.bind(history)
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    originalPushState(...args)
    fire()
  }

  const originalReplaceState = history.replaceState.bind(history)
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    originalReplaceState(...args)
    fire()
  }

  window.addEventListener("popstate", fire)
}

export function watchForComposer(
  findInput: () => HTMLElement | null,
  findSendButton: () => HTMLElement | null,
  onReady: (input: HTMLElement, sendButton: HTMLElement | null) => void
): MutationObserver {
  patchHistoryOnce()

  // Deliberately NOT deduped by "have we seen this input before" - several
  // sites (Gemini's Angular composer especially) swap the send BUTTON
  // between disabled/enabled DOM nodes as the user types, even while the
  // input element itself stays the same. A one-time capture on first sight
  // of the input would leave the tracked button reference pointing at a
  // detached node by the time the user actually clicks it, silently
  // breaking interception. onReady (content/index.ts's attach()) is a
  // cheap no-op-ish assignment, so refreshing on every tick costs nothing
  // and guarantees the tracked button is always the one currently live.
  const check = () => {
    const input = findInput()
    if (input) {
      onReady(input, findSendButton())
    }
  }

  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true })

  const pollId = window.setInterval(check, 1500)
  navigationListeners.add(check)

  // MutationObserver has no built-in "stop everything" beyond disconnect(),
  // so piggyback the interval/nav-listener cleanup onto it.
  const originalDisconnect = observer.disconnect.bind(observer)
  observer.disconnect = () => {
    window.clearInterval(pollId)
    navigationListeners.delete(check)
    originalDisconnect()
  }

  check() // run once immediately in case the composer is already mounted
  return observer
}
