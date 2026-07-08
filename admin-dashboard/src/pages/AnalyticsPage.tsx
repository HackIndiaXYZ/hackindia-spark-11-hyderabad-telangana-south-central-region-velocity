import { useQuery } from "@tanstack/react-query"
import { BarChart3 } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
import { getAnalyticsSummary } from "@/lib/adminApi"
import { formatShortDate } from "@/lib/format"

const CHART_COLORS = { ALLOW: "#16a34a", WARN: "#d97706", REDACT: "#6366f1", BLOCK: "#dc2626" }
const PIE_COLORS = ["#16a34a", "#dc2626", "#6366f1", "#d97706", "#0ea5e9"]

const tooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
}

export function AnalyticsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: getAnalyticsSummary,
  })

  if (isError) return <ErrorState message="Couldn't load analytics." onRetry={() => refetch()} />

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  const totalTraffic = Object.values(data.blocked_vs_allowed).reduce((a, b) => a + b, 0)
  const hasData = totalTraffic > 0 || data.daily_activity.some((d) => d.ALLOW + d.WARN + d.REDACT + d.BLOCK > 0)

  if (!hasData) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={BarChart3}
            title="No analytics yet"
            description="Charts will populate automatically as employees use the browser extension and prompts get scanned."
          />
        </CardContent>
      </Card>
    )
  }

  const blockedVsAllowedData = Object.entries(data.blocked_vs_allowed).map(([action, count]) => ({ action, count }))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Daily Prompt Usage</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.daily_activity}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--color-muted-foreground)" allowDecimals={false} />
              <Tooltip labelFormatter={(v) => formatShortDate(String(v))} contentStyle={tooltipStyle} />
              {(["ALLOW", "WARN", "REDACT", "BLOCK"] as const).map((key) => (
                <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={CHART_COLORS[key]} fill={CHART_COLORS[key]} fillOpacity={0.35} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Blocked vs Allowed</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={blockedVsAllowedData} dataKey="count" nameKey="action" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {blockedVsAllowedData.map((d) => (
                  <Cell key={d.action} fill={d.action === "BLOCK" ? "#dc2626" : "#16a34a"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Risk Trend (avg. score / day)</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.risk_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--color-muted-foreground)" domain={[0, 100]} />
              <Tooltip labelFormatter={(v) => formatShortDate(String(v))} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="average_risk_score" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top Triggered Rules</CardTitle></CardHeader>
        <CardContent className="h-72">
          {data.top_triggered_rules.length === 0 ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">No violations recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.top_triggered_rules} layout="vertical" margin={{ left: 16 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis dataKey="detector" type="category" width={120} fontSize={11} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="var(--color-danger)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Website Usage</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.website_usage} dataKey="count" nameKey="website" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {data.website_usage.map((entry, i) => (
                  <Cell key={entry.website} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Department Usage</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.department_usage}>
              <XAxis dataKey="department" fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--color-muted-foreground)" allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Uploaded File Types</CardTitle></CardHeader>
        <CardContent className="h-72">
          {data.file_stats.file_type_breakdown.length === 0 ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">No files scanned yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.file_stats.file_type_breakdown} layout="vertical" margin={{ left: 16 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis dataKey="extension" type="category" width={80} fontSize={11} stroke="var(--color-muted-foreground)" tickFormatter={(v) => `.${v}`} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sensitive File Categories (Files Scanning)</CardTitle></CardHeader>
        <CardContent className="h-72">
          {data.file_stats.top_sensitive_categories.length === 0 ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">No high-risk file uploads yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.file_stats.top_sensitive_categories} layout="vertical" margin={{ left: 16 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis dataKey="category" type="category" width={110} fontSize={11} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="var(--color-danger)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Top Employees by Violations</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.top_employees_by_violations.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No violations recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Employee</th>
                  <th className="px-5 py-2.5 font-medium">Department</th>
                  <th className="px-5 py-2.5 font-medium">Violations</th>
                </tr>
              </thead>
              <tbody>
                {data.top_employees_by_violations.map((emp) => (
                  <tr key={emp.email} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{emp.full_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.email}</p>
                    </td>
                    <td className="px-5 py-2.5">{emp.department ?? "—"}</td>
                    <td className="px-5 py-2.5 font-medium text-warning">{emp.violation_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
