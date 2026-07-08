import type { ReactNode } from "react"
import { ShieldHalf } from "lucide-react"

interface ModalShellProps {
  tone: "warn" | "block"
  title: string
  subtitle?: string
  children: ReactNode
  footer: ReactNode
}

const TONE_STYLES: Record<ModalShellProps["tone"], { badge: string }> = {
  warn: { badge: "ps-icon-glass-warning" },
  block: { badge: "ps-icon-glass-danger" },
}

export function ModalShell({ tone, title, subtitle, children, footer }: ModalShellProps) {
  const styles = TONE_STYLES[tone]
  return (
    <div
      className="promptshield-root ps-anim-overlay fixed inset-0 z-[2147483000] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--overlay)", isolation: "isolate" }}
    >
      <div
        className="ps-panel ps-anim-modal w-full max-w-md rounded-2xl text-card-foreground"
        style={{ isolation: "isolate" }}
      >
        <div className="flex items-start gap-3 border-b p-5" style={{ borderColor: "var(--surface-border)" }}>
          <div className={`ps-icon-glass h-9 w-9 shrink-0 ${styles.badge}`}>
            <ShieldHalf className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 className="ps-title text-[16px] leading-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        <div className="ps-scroll max-h-[60vh] overflow-y-auto p-5">{children}</div>

        <div
          className="flex items-center justify-end gap-2 border-t p-4"
          style={{ borderColor: "var(--surface-border)" }}
        >
          {footer}
        </div>
      </div>
    </div>
  )
}
