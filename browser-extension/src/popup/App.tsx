import { useEffect, useState, type FormEvent } from "react"
import {
  LogOut,
  Loader2,
  CheckCircle2,
  Wifi,
  WifiOff,
  Moon,
  Sun,
  Globe,
  Clock,
  Building2,
  RefreshCw,
} from "lucide-react"
import type { AuthState, BackendStatus, ExtensionMessage, LastScan } from "@/types/messages"
import { Logo } from "@/components/Logo"
import { getTheme, setTheme as persistTheme, type Theme } from "@/services/theme"
import { deriveOrgName, isSupportedHostname, timeAgo } from "@/utils/org"
import { ACTION_LABELS } from "@/utils/labels"

// Must match the same literal used in background/index.ts.
const REOPEN_POPUP_KEY = "promptshield_reopen_popup"

function sendMessage<T = unknown>(message: ExtensionMessage): Promise<T> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve))
}

async function getActiveTabHostname(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) return null
    return new URL(tab.url).hostname
  } catch {
    return null
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ isAuthenticated: false, user: null })
  const [isLoading, setIsLoading] = useState(true)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [theme, setThemeState] = useState<Theme>("light")
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null)
  const [protectionEnabled, setProtectionEnabled] = useState(true)
  const [hostname, setHostname] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    Promise.all([
      sendMessage<AuthState>({ type: "GET_AUTH_STATE" }),
      getTheme(),
      sendMessage<BackendStatus>({ type: "GET_BACKEND_STATUS" }),
      sendMessage<{ enabled: boolean }>({ type: "GET_PROTECTION_ENABLED" }),
      getActiveTabHostname(),
      sendMessage<LastScan | null>({ type: "GET_LAST_SCAN" }),
    ])
      .then(([authState, currentTheme, status, protection, host, scan]) => {
        setAuth(authState)
        setThemeState(currentTheme)
        setBackendStatus(status)
        setProtectionEnabled(protection.enabled)
        setHostname(host)
        setLastScan(scan)
      })
      .finally(() => setIsLoading(false))
  }, [])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await sendMessage<AuthState & { error?: string }>({
        type: "LOGIN",
        payload: { email, password },
      })
      if (result.error) throw new Error(result.error)
      setAuth(result)
    } catch {
      setError("Incorrect email or password.")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLogout() {
    const result = await sendMessage<AuthState>({ type: "LOGOUT" })
    setAuth(result)
  }

  // Reloads the extension itself only - picks up whatever is currently
  // built on disk, identical to clicking "reload" on chrome://extensions
  // (background service worker restarts, popup re-mounts fresh). Does NOT
  // touch any open tab or page the user is on.
  //
  // chrome.runtime.reload() tears down this popup's own JS context along
  // with everything else, closing the popup window - there's no way to
  // keep the SAME popup instance alive across a real extension reload,
  // that's Chrome's own behavior. The best available fix: leave a flag in
  // storage right before reloading, and have the background service
  // worker (which runs its top-level code fresh on every restart,
  // including immediately after this reload) check that flag and
  // reopen the popup automatically via chrome.action.openPopup().
  async function handleRefresh() {
    setIsRefreshing(true)
    await chrome.storage.local.set({ [REOPEN_POPUP_KEY]: true })
    chrome.runtime.reload()
  }

  async function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    setThemeState(next)
    await persistTheme(next)
  }

  async function toggleProtection() {
    const next = !protectionEnabled
    setProtectionEnabled(next)
    await sendMessage({ type: "SET_PROTECTION_ENABLED", payload: { enabled: next } })
  }

  const isOnSupportedSite = hostname ? isSupportedHostname(hostname) : false

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span className="ps-title text-[15px]">PromptShield AI</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="ps-icon-btn h-7 w-7"
            aria-label="Reload extension"
            title="Reload the extension"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={toggleTheme} className="ps-icon-btn h-7 w-7" aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : auth.isAuthenticated && auth.user ? (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${
              protectionEnabled ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {protectionEnabled ? "Protection active" : "Protection paused"}
          </div>

          <div className="ps-panel rounded-xl p-3.5">
            <p className="text-sm font-medium leading-none">{auth.user.full_name}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{auth.user.email}</p>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {deriveOrgName(auth.user.email)}
              <span className="mx-1">·</span>
              <span className="capitalize">{auth.user.role.replace("_", " ")}</span>
            </div>
          </div>

          <div className="ps-panel space-y-2.5 rounded-xl p-3.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {backendStatus?.online ? (
                  <Wifi className="h-3.5 w-3.5 text-success" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-danger" />
                )}
                Backend
              </span>
              <span className={backendStatus?.online ? "text-success" : "text-danger"}>
                {backendStatus === null ? "Checking…" : backendStatus.online ? "Online" : "Offline"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                This site
              </span>
              <span className={isOnSupportedSite ? "text-success" : "text-muted-foreground"}>
                {hostname ? (isOnSupportedSite ? hostname : "Not monitored") : "—"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Last scan
              </span>
              <span className="text-foreground">
                {lastScan ? `${ACTION_LABELS[lastScan.decision] ?? lastScan.decision} · ${timeAgo(lastScan.at)}` : "No scans yet"}
              </span>
            </div>
          </div>

          <button
            onClick={toggleProtection}
            className="ps-panel flex w-full items-center justify-between rounded-xl p-3.5 text-left text-sm transition-[filter] duration-150 hover:brightness-95 active:brightness-90"
          >
            <span>Protection enabled</span>
            <span
              className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${
                protectionEnabled ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
                  protectionEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>

          <button onClick={handleLogout} className="ps-btn ps-btn-secondary w-full">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={handleLogin} className="space-y-3">
          <p className="text-xs text-muted-foreground">Sign in to activate prompt protection.</p>
          <input
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-shadow duration-150 focus:ring-2 focus:ring-primary/40"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-shadow duration-150 focus:ring-2 focus:ring-primary/40"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <button type="submit" disabled={isSubmitting} className="ps-btn ps-btn-primary w-full">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
      )}
    </div>
  )
}
