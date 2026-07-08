import { useEffect } from "react"
import { CheckCircle2, X } from "lucide-react"

interface RedactToastProps {
  message: string
  onDismiss: () => void
}

export function RedactToast({ message, onDismiss }: RedactToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 7000)
    return () => window.clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className="promptshield-root ps-anim-toast fixed bottom-6 left-1/2 z-[2147483000] w-full max-w-sm -translate-x-1/2 px-4"
      style={{ isolation: "isolate" }}
    >
      <div
        className="ps-panel flex items-start gap-3 rounded-2xl p-4 text-sm"
        style={{ boxShadow: "var(--shadow-toast)", isolation: "isolate" }}
      >
        <div className="ps-icon-glass ps-icon-glass-success h-8 w-8 shrink-0">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="ps-title text-[15px] leading-snug text-card-foreground">Prompt was automatically sanitized</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground transition-colors duration-150 hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
