import { useQuery } from "@tanstack/react-query"
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  EyeOff,
  MessageSquare,
  Users,
  Globe2,
  Inbox,
  FileText,
  FileWarning,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Skeleton } from "@/components/ui/Skeleton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorState } from "@/components/ui/ErrorState"
import { ActionBadge } from "@/components/StatusBadges"
import { getDashboardSummary } from "@/lib/adminApi"
import { formatShortDate, timeAgo } from "@/lib/format"

const CHART_COLORS = {
  ALLOW: "#16a34a",
  WARN: "#d97706",
  REDACT: "#6366f1",
  BLOCK: "#dc2626",
}

const RISK_COLORS: Record<string, string> = {
  NONE: "#94a3b8",
  LOW: "#16a34a",
  MEDIUM: "#d97706",
  HIGH: "#ea580c",
  CRITICAL: "#dc2626",
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-3 w-20" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-16" />
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
  })

  if (isError) {
    return <ErrorState message="Couldn't load the dashboard summary." onRetry={() => refetch()} />
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }

  const cards = [
    { label: "Security Score", value: `${data.security_score}`, suffix: "/100", icon: ShieldCheck, tone: "text-success" },
    { label: "Total Prompts", value: data.total_prompts.toLocaleString(), icon: MessageSquare, tone: "text-primary" },
    { label: "Allowed", value: data.allowed.toLocaleString(), icon: CheckCircle2, tone: "text-success" },
    { label: "Warned", value: data.warned.toLocaleString(), icon: AlertTriangle, tone: "text-warning" },
    { label: "Redacted", value: data.redacted.toLocaleString(), icon: EyeOff, tone: "text-primary" },
    { label: "Blocked", value: data.blocked.toLocaleString(), icon: XCircle, tone: "text-danger" },
    { label: "Active Employees", value: data.active_employees.toLocaleString(), icon: Users, tone: "text-foreground" },
    { label: "Protected AI Websites", value: data.protected_websites.toLocaleString(), icon: Globe2, tone: "text-foreground" },
  ]

  const hasActivity = data.total_prompts > 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle>{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <c.icon className={`h-5 w-5 ${c.tone}`} />
              <span className="text-2xl font-semibold">{c.value}</span>
              {c.suffix && <span className="text-sm text-muted-foreground">{c.suffix}</span>}
            </CardContent>
          </Card>
        ))}
      </div>

      {!hasActivity ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Inbox}
              title="No prompt activity yet"
              description="Once employees start using the browser extension, scans will appear here in real time."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Daily Prompt Activity</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily_activity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                    />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(v) => formatShortDate(String(v))}
                      contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    />
                    {(["ALLOW", "WARN", "REDACT", "BLOCK"] as const).map((key) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stackId="1"
                        stroke={CHART_COLORS[key]}
                        fill={CHART_COLORS[key]}
                        fillOpacity={0.35}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Risk Distribution</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.risk_distribution.filter((r) => r.count > 0)}
                      dataKey="count"
                      nameKey="risk"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {data.risk_distribution.map((r) => (
                        <Cell key={r.risk} fill={RISK_COLORS[r.risk]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-3 text-xs">
                  {data.risk_distribution.filter((r) => r.count > 0).map((r) => (
                    <span key={r.risk} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[r.risk] }} />
                      {r.risk} ({r.count})
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Top Violations</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                {data.top_violations.length === 0 ? (
                  <p className="pt-8 text-center text-sm text-muted-foreground">No violations yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.top_violations} layout="vertical" margin={{ left: 16 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="detector" type="category" width={110} fontSize={11} stroke="var(--color-muted-foreground)" />
                      <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI Website Usage</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.website_usage}>
                    <XAxis dataKey="website" fontSize={11} stroke="var(--color-muted-foreground)" />
                    <YAxis fontSize={11} stroke="var(--color-muted-foreground)" allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Department Usage</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.department_usage}>
                    <XAxis dataKey="department" fontSize={11} stroke="var(--color-muted-foreground)" />
                    <YAxis fontSize={11} stroke="var(--color-muted-foreground)" allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" fill="var(--color-success)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Files Scanned</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-2xl font-semibold">{data.file_stats.total_files_scanned.toLocaleString()}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Blocked Uploads</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-danger" />
                <span className="text-2xl font-semibold">{data.file_stats.blocked_uploads.toLocaleString()}</span>
              </CardContent>
            </Card>
          </div>

          {data.file_stats.total_files_scanned > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Uploaded File Types</CardTitle>
                </CardHeader>
                <CardContent className="h-56">
                  {data.file_stats.file_type_breakdown.length === 0 ? (
                    <p className="pt-8 text-center text-sm text-muted-foreground">No files scanned yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.file_stats.file_type_breakdown} layout="vertical" margin={{ left: 8 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          dataKey="extension"
                          type="category"
                          width={70}
                          fontSize={11}
                          stroke="var(--color-muted-foreground)"
                          tickFormatter={(v) => `.${v}`}
                        />
                        <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Sensitive File Categories</CardTitle>
                </CardHeader>
                <CardContent className="h-56">
                  {data.file_stats.top_sensitive_categories.length === 0 ? (
                    <p className="pt-8 text-center text-sm text-muted-foreground">No high-risk file uploads yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.file_stats.top_sensitive_categories} layout="vertical" margin={{ left: 8 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis dataKey="category" type="category" width={90} fontSize={11} stroke="var(--color-muted-foreground)" />
                        <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" fill="var(--color-danger)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Employee</th>
                    <th className="px-5 py-2.5 font-medium">Website</th>
                    <th className="px-5 py-2.5 font-medium">Action</th>
                    <th className="px-5 py-2.5 font-medium">Score</th>
                    <th className="px-5 py-2.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_activity.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-5 py-2.5">{item.employee_name}</td>
                      <td className="px-5 py-2.5">{item.website}</td>
                      <td className="px-5 py-2.5">
                        <ActionBadge action={item.action} />
                      </td>
                      <td className="px-5 py-2.5">{item.score}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{timeAgo(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
