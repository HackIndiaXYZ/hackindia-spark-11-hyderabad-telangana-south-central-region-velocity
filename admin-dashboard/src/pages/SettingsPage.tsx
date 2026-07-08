import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Save, Plus, X, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { Toggle } from "@/components/ui/Toggle"
import { Skeleton } from "@/components/ui/Skeleton"
import { useTheme } from "@/context/ThemeContext"
import {
  createKeyword,
  deleteKeyword,
  getKeywords,
  getSettings,
  updateKeyword,
  updateSettings,
} from "@/lib/adminApi"

// Kept in sync with the backend's full extraction-capable set
// (backend/ai/file_scanner.py FILE_CATEGORIES / backend/models/settings.py
// OrgSettings.allowed_file_types default) - grouped the same way so this
// list is easy to eyeball against that one when either changes.
const FILE_TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "Documents", types: ["pdf", "docx", "txt"] },
  {
    label: "Source code",
    types: [
      "java", "py", "js", "jsx", "ts", "tsx", "cpp", "cc", "cxx", "h", "hpp", "c", "cs",
      "go", "rs", "php", "html", "htm", "css", "sql",
    ],
  },
  { label: "Configuration", types: ["env", "properties", "yaml", "yml", "json", "xml"] },
  { label: "Data", types: ["csv", "xlsx"] },
  { label: "Logs", types: ["log"] },
  { label: "Images (OCR)", types: ["png", "jpg", "jpeg"] },
]
const ALL_FILE_TYPES = FILE_TYPE_GROUPS.flatMap((g) => g.types)
const ALL_WEBSITES = ["ChatGPT", "Claude", "Gemini"]

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()

  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const { data: keywords } = useQuery({ queryKey: ["keywords"], queryFn: getKeywords })

  const [orgName, setOrgName] = useState("")
  const [riskThreshold, setRiskThreshold] = useState(70)
  const [websites, setWebsites] = useState<string[]>([])
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState("")
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setOrgName(settings.organization_name)
    setRiskThreshold(settings.risk_threshold)
    setWebsites(settings.supported_websites)
    setFileTypes(settings.allowed_file_types)
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    },
  })

  const addKeywordMutation = useMutation({
    mutationFn: createKeyword,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywords"] })
      setNewKeyword("")
    },
  })

  const toggleKeywordMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateKeyword(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keywords"] }),
  })

  const removeKeywordMutation = useMutation({
    mutationFn: deleteKeyword,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keywords"] }),
  })

  function toggleInList(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function handleSave() {
    saveMutation.mutate({
      organization_name: orgName,
      risk_threshold: riskThreshold,
      supported_websites: websites,
      allowed_file_types: fileTypes,
    })
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Organization name</label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Risk threshold (0-100)</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={riskThreshold}
              onChange={(e) => setRiskThreshold(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Prompts scoring at or above this are treated as high-risk in reporting.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Supported AI websites</label>
            <div className="flex flex-wrap gap-2">
              {ALL_WEBSITES.map((site) => (
                <button key={site} type="button" onClick={() => toggleInList(websites, setWebsites, site)}>
                  <Badge tone={websites.includes(site) ? "success" : "muted"}>{site}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Allowed file types</label>
              <p className="text-xs text-muted-foreground">
                Files scanned before upload; any type left off here is rejected without its content being read.
              </p>
            </div>
            {FILE_TYPE_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  {group.types.map((type) => (
                    <button key={type} type="button" onClick={() => toggleInList(fileTypes, setFileTypes, type)}>
                      <Badge tone={fileTypes.includes(type) ? "success" : "muted"}>.{type}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
            {justSaved && (
              <span className="flex items-center gap-1 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Saved to MySQL
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Dashboard theme</p>
            <p className="text-xs text-muted-foreground">Personal preference, stored in this browser only.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>
              Light
            </Button>
            <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>
              Dark
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Company Keywords</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Flagged by the Company Keyword Detector whenever they appear in a prompt.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Add a keyword..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newKeyword.trim()) addKeywordMutation.mutate(newKeyword.trim())
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newKeyword.trim() || addKeywordMutation.isPending}
              onClick={() => addKeywordMutation.mutate(newKeyword.trim())}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          <div className="space-y-1.5">
            {(keywords ?? []).map((kw) => (
              <div key={kw.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className={kw.enabled ? "" : "text-muted-foreground line-through"}>{kw.keyword}</span>
                <div className="flex items-center gap-2">
                  <Toggle
                    checked={kw.enabled}
                    onChange={(enabled) => toggleKeywordMutation.mutate({ id: kw.id, enabled })}
                  />
                  <button
                    onClick={() => removeKeywordMutation.mutate(kw.id)}
                    aria-label={`Remove keyword ${kw.keyword}`}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {(keywords ?? []).length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No company keywords configured.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
