/**
 * Background service worker (Manifest V3, type "module").
 * Owns backend HTTP calls and the auth token so page-level CSPs on
 * ChatGPT/Claude/Gemini can never interfere with either.
 *
 * Milestone 3 additions: client-side JWT expiry detection (no refresh
 * endpoint exists - see utils/jwt.ts), periodic backend connectivity
 * polling via chrome.alarms (service workers can be suspended, so a
 * setInterval would silently stop - alarms survive that), a
 * protection-enabled kill switch, and last-scan tracking for the popup.
 */
import { ScanUnauthorizedError, checkBackendHealth, fetchCurrentUser, loginRequest, scanPrompt } from "@/services/api"
import { isTokenExpired } from "@/utils/jwt"
import type { AuthState, BackendStatus, ExtensionMessage, LastScan } from "@/types/messages"

const TOKEN_KEY = "promptshield_token"
const USER_KEY = "promptshield_user"
const BACKEND_STATUS_KEY = "promptshield_backend_status"
const PROTECTION_KEY = "promptshield_protection_enabled"
const LAST_SCAN_KEY = "promptshield_last_scan"
// Must match the same literal used in popup/App.tsx.
const REOPEN_POPUP_KEY = "promptshield_reopen_popup"

const HEALTH_ALARM = "promptshield-health-check"
const HEALTH_CHECK_INTERVAL_MINUTES = 2

// chrome.runtime.reload() (triggered by the popup's own refresh button)
// tears down the popup along with everything else - there's no way to
// keep that specific popup window alive across a real extension reload.
// This top-level code runs fresh every time the service worker starts,
// including immediately after such a reload, so it's the right place to
// check "did the user just ask to be reloaded?" and reopen the popup for
// them automatically instead of leaving them to click the toolbar icon
// again themselves.
void (async () => {
  const stored = await chrome.storage.local.get(REOPEN_POPUP_KEY)
  if (!stored[REOPEN_POPUP_KEY]) return
  await chrome.storage.local.remove(REOPEN_POPUP_KEY)
  try {
    await chrome.action.openPopup()
  } catch (err) {
    // openPopup() requires Chrome 127+ and can still fail on some window
    // states - failing silently just means the user clicks the toolbar
    // icon once themselves, exactly like before this feature existed.
    console.info("[PromptShield AI] Could not auto-reopen popup after reload:", err)
  }
})()

async function getAuthState(): Promise<AuthState> {
  const stored = await chrome.storage.local.get([TOKEN_KEY, USER_KEY])
  const token = stored[TOKEN_KEY] as string | undefined
  const user = stored[USER_KEY] as AuthState["user"] | undefined
  if (!token || !user) return { isAuthenticated: false, user: null }
  return { isAuthenticated: true, user }
}

async function getToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(TOKEN_KEY)
  return (stored[TOKEN_KEY] as string | undefined) ?? null
}

async function isProtectionEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PROTECTION_KEY)
  const value = stored[PROTECTION_KEY] as boolean | undefined
  return value ?? true // protection is on by default
}

async function runHealthCheck(): Promise<BackendStatus> {
  const online = await checkBackendHealth()
  const status: BackendStatus = { online, lastCheckedAt: Date.now() }
  await chrome.storage.local.set({ [BACKEND_STATUS_KEY]: status })
  return status
}

// --- lifecycle: install/startup wiring for the alarm-driven health check ---
chrome.runtime.onInstalled.addListener(() => {
  console.info("[PromptShield AI] background service worker installed")
  chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: HEALTH_CHECK_INTERVAL_MINUTES })
  void runHealthCheck()
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: HEALTH_CHECK_INTERVAL_MINUTES })
  void runHealthCheck()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_ALARM) void runHealthCheck()
})

// --- messaging ---
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : "Unknown error" }))
  return true // keep the message channel open for the async response
})

async function handleMessage(message: ExtensionMessage) {
  switch (message.type) {
    case "LOGIN": {
      const { email, password } = message.payload
      const result = await loginRequest(email, password)
      // Milestone 6 fix: promptshield_last_scan was a single global key with
      // no notion of "whose" scan it was. Logging in as a different account
      // in the same browser profile would keep showing the PREVIOUS
      // account's last-scan time/site/decision in the popup, since nothing
      // ever cleared it. A fresh login always starts a fresh session, so
      // wipe any leftover scan history from whoever used the extension
      // before this login.
      await chrome.storage.local.remove(LAST_SCAN_KEY)
      await chrome.storage.local.set({ [TOKEN_KEY]: result.access_token, [USER_KEY]: result.user })
      return { isAuthenticated: true, user: result.user } satisfies AuthState
    }

    case "LOGOUT": {
      await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, LAST_SCAN_KEY])
      return { isAuthenticated: false, user: null } satisfies AuthState
    }

    case "GET_AUTH_STATE": {
      const state = await getAuthState()
      if (!state.isAuthenticated) return state

      const token = await getToken()
      if (!token || isTokenExpired(token)) {
        // No refresh-token endpoint exists (Milestone 3 keeps the backend
        // API unchanged) - an expired token means a clean re-login, not a
        // silent refresh. Detecting this client-side skips a doomed
        // network round-trip to /api/auth/me. Also clear last-scan here for
        // the same cross-account leakage reason as LOGOUT above - an
        // expired session ends this account's context just as much as an
        // explicit sign-out does.
        await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, LAST_SCAN_KEY])
        return { isAuthenticated: false, user: null } satisfies AuthState
      }

      try {
        const user = await fetchCurrentUser(token)
        await chrome.storage.local.set({ [USER_KEY]: user })
        return { isAuthenticated: true, user } satisfies AuthState
      } catch {
        await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, LAST_SCAN_KEY])
        return { isAuthenticated: false, user: null } satisfies AuthState
      }
    }

    case "SCAN_PROMPT": {
      if (!(await isProtectionEnabled())) {
        return { decision: "ALLOW", sanitized_prompt: message.payload.prompt, findings: [] }
      }
      const token = await getToken()

      // Milestone 6 hardening: previously this called scanPrompt()
      // unconditionally even with a known-expired token, unlike
      // GET_AUTH_STATE which already checked isTokenExpired - relying on
      // the backend to reject it with a 401 instead of catching it
      // client-side. Check first to skip a doomed round-trip, consistent
      // with GET_AUTH_STATE's handling.
      if (token && isTokenExpired(token)) {
        await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, LAST_SCAN_KEY])
        return { decision: "ALLOW", sanitized_prompt: message.payload.prompt, findings: [] }
      }

      try {
        return await scanPrompt(
          token,
          message.payload.prompt,
          message.payload.site,
          message.payload.files ?? []
        )
      } catch (err) {
        if (err instanceof ScanUnauthorizedError) {
          // The backend rejected the token even though it looked
          // unexpired client-side (revoked, clock skew, secret rotated).
          // Clear the stale session so the next popup open / auth check
          // surfaces "please sign in again" instead of silently staying
          // "signed in" with zero protection from here on.
          await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, LAST_SCAN_KEY])
          return { decision: "ALLOW", sanitized_prompt: message.payload.prompt, findings: [] }
        }
        throw err
      }
    }

    case "LOG_ACTIVITY": {
      const entry: LastScan = { ...message.payload, at: Date.now() }
      await chrome.storage.local.set({ [LAST_SCAN_KEY]: entry })
      console.info("[PromptShield AI] activity", entry)
      return { ok: true }
    }

    case "GET_BACKEND_STATUS": {
      const stored = await chrome.storage.local.get(BACKEND_STATUS_KEY)
      const cached = stored[BACKEND_STATUS_KEY] as BackendStatus | undefined
      const isStale = !cached || Date.now() - (cached.lastCheckedAt ?? 0) > HEALTH_CHECK_INTERVAL_MINUTES * 60_000 * 2
      return isStale ? runHealthCheck() : cached
    }

    case "GET_PROTECTION_ENABLED": {
      return { enabled: await isProtectionEnabled() }
    }

    case "SET_PROTECTION_ENABLED": {
      await chrome.storage.local.set({ [PROTECTION_KEY]: message.payload.enabled })
      return { enabled: message.payload.enabled }
    }

    case "GET_LAST_SCAN": {
      const stored = await chrome.storage.local.get(LAST_SCAN_KEY)
      return (stored[LAST_SCAN_KEY] as LastScan | undefined) ?? null
    }

    default:
      return { error: "Unknown message type" }
  }
}
