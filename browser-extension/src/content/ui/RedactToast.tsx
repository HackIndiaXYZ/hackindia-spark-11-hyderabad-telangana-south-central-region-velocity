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
        className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm shadow-2xl"
        style={{ background: "var(--card)", isolation: "isolate" }}
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-card-foreground">Prompt was automatically sanitized</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
        </div>
        <button onClick={onDismiss} className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
