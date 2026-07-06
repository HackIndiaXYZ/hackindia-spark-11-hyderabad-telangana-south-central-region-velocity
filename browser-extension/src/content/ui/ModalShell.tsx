import type { ReactNode } from "react"
import { ShieldHalf } from "lucide-react"

interface ModalShellProps {
  tone: "warn" | "block"
  title: string
  subtitle?: string
  children: ReactNode
  footer: ReactNode
}

const TONE_STYLES: Record<ModalShellProps["tone"], { icon: string; ring: string }> = {
  warn: { icon: "text-warning", ring: "ring-warning/30" },
  block: { icon: "text-danger", ring: "ring-danger/30" },
}

export function ModalShell({ tone, title, subtitle, children, footer }: ModalShellProps) {
  const styles = TONE_STYLES[tone]
  return (
    <div
      className="promptshield-root ps-anim-overlay fixed inset-0 z-[2147483000] flex items-center justify-center p-4"
      style={{ background: "var(--overlay)", isolation: "isolate" }}
    >
      <div
        className={`ps-anim-modal w-full max-w-md rounded-2xl border border-border text-card-foreground shadow-2xl ring-4 ${styles.ring}`}
        style={{ background: "var(--card)", isolation: "isolate" }}
      >
        <div className="flex items-start gap-3 border-b border-border p-5" style={{ background: "var(--card)" }}>
          <div className={`mt-0.5 shrink-0 ${styles.icon}`}>
            <ShieldHalf className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5" style={{ background: "var(--card)" }}>
          {children}
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t border-border p-4"
          style={{ background: "var(--card)" }}
        >
          {footer}
        </div>
      </div>
    </div>
  )
}
