import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Filter, Eye, EyeOff, ScrollText, ArrowUpDown, Paperclip } from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Select } from "@/components/ui/Select"
import { Skeleton } from "@/components/ui/Skeleton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorState } from "@/components/ui/ErrorState"
import { Pagination } from "@/components/ui/Pagination"
import { Drawer } from "@/components/ui/Drawer"
import { ActionBadge, RiskBadge } from "@/components/StatusBadges"
import { getPromptLogDetail, getPromptLogs } from "@/lib/adminApi"
import { formatDateTime } from "@/lib/format"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"

const ACTIONS = ["ALLOW", "WARN", "REDACT", "BLOCK"]
const RISKS = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
const WEBSITES = ["ChatGPT", "Claude", "Gemini"]

export function PromptLogsPage() {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 300)
  const [action, setAction] = useState("")
  const [risk, setRisk] = useState("")
  const [website, setWebsite] = useState("")
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<"created_at" | "score">("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["prompt-logs", { search: debouncedSearch, action, risk, website, page, sortBy, sortDir }],
    queryFn: () =>
      getPromptLogs({
        page,
        page_size: 15,
        search: debouncedSearch || undefined,
        action: action || undefined,
        risk: risk || undefined,
        website: website || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      }),
  })

  function toggleSort(column: "created_at" | "score") {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(column)
      setSortDir("desc")
    }
    setPage(1)
  }

  function resetFilters() {
    setSearch("")
    setAction("")
    setRisk("")
    setWebsite("")
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by employee name or email..."
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1) }}>
            <option value="">All risk levels</option>
            {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select value={website} onChange={(e) => { setWebsite(e.target.value); setPage(1) }}>
            <option value="">All websites</option>
            {WEBSITES.map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
          {(search || action || risk || website) && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <ErrorState message="Couldn't load prompt logs." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No prompt logs found"
              description="Either no prompts have been scanned yet, or no results match your current filters."
            />
          ) : (
            <>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Employee</th>
                    <th className="px-5 py-3 font-medium">AI Website</th>
                    <th className="px-5 py-3 font-medium">Files</th>
                    <th className="px-5 py-3 font-medium">Risk</th>
                    <th className="px-5 py-3 font-medium">
                      <button className="flex items-center gap-1" onClick={() => toggleSort("score")}>
                        Score <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-5 py-3 font-medium">Action</th>
                    <th className="px-5 py-3 font-medium">
                      <button className="flex items-center gap-1" onClick={() => toggleSort("created_at")}>
                        Time <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedId(log.id)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium">{log.employee_name}</p>
                        <p className="text-xs text-muted-foreground">{log.employee_email}</p>
                      </td>
                      <td className="px-5 py-3">{log.website}</td>
                      <td className="px-5 py-3">
                        {log.has_files ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Paperclip className="h-3 w-3" /> {log.file_count}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3"><RiskBadge risk={log.risk} /></td>
                      <td className="px-5 py-3">{log.score}</td>
                      <td className="px-5 py-3"><ActionBadge action={log.action} /></td>
                      <td className="px-5 py-3 text-muted-foreground">{formatDateTime(log.created_at)}</td>
                      <td className="px-5 py-3">
                        <span className={log.status === "Clean" ? "text-success" : "text-warning"}>{log.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={data.page}
                totalPages={data.total_pages}
                total={data.total}
                pageSize={data.page_size}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <PromptLogDrawer id={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  )
}

function PromptLogDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [showOriginal, setShowOriginal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["prompt-log-detail", id],
    queryFn: () => getPromptLogDetail(id!),
    enabled: !!id,
  })

  return (
    <Drawer
      open={!!id}
      onClose={() => {
        onClose()
        setShowOriginal(false)
      }}
      title="Prompt Log Detail"
      subtitle={data ? `${data.employee_name} · ${data.website}` : undefined}
    >
      {isLoading || !data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Decision</p>
              <div className="mt-1"><ActionBadge action={data.action} /></div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Risk</p>
              <div className="mt-1"><RiskBadge risk={data.risk} /> <span className="text-xs text-muted-foreground">({data.score}/100)</span></div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Website</p>
              <p className="mt-1">{data.website}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Timestamp</p>
              <p className="mt-1">{formatDateTime(data.created_at)}</p>
            </div>
          </div>

          {data.files.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">
                Attached Files ({data.files.length})
              </p>
              <ul className="space-y-1.5">
                {data.files.map((file, i) => (
                  <li key={i} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium" title={file.filename}>
                        {file.filename}
                      </span>
                      <RiskBadge risk={file.risk} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {file.category} · .{file.extension || "?"}
                      {file.size_bytes != null && ` · ${(file.size_bytes / 1024).toFixed(1)} KB`}
                      {!file.extracted && file.extraction_note && ` · ${file.extraction_note}`}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.triggered_policy && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Triggered Policy</p>
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2">{data.triggered_policy}</p>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium uppercase text-muted-foreground">Original Prompt (masked)</p>
              <button
                onClick={() => setShowOriginal((s) => !s)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {showOriginal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showOriginal ? "Hide" : "Show original"}
              </button>
            </div>
            <p
              className={`whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs ${
                showOriginal ? "" : "blur-sm select-none"
              }`}
            >
              {data.original_prompt}
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Sanitized Prompt</p>
            <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
              {data.sanitized_prompt}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Detector Results</p>
            {data.triggered_rules.length === 0 ? (
              <p className="text-xs text-muted-foreground">No detectors fired on this prompt.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.triggered_rules.map((rule, i) => (
                  <li key={i} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{rule.detector}</span>
                      <RiskBadge risk={rule.severity} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{rule.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Reason</p>
            <p className="text-sm text-foreground">{data.reason}</p>
          </div>
        </div>
      )}
    </Drawer>
  )
}
