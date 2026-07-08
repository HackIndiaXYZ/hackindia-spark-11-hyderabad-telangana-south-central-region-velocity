/** TypeScript mirrors of the Milestone 4 backend Pydantic schemas. */

export type Action = "ALLOW" | "WARN" | "REDACT" | "BLOCK"
export type Risk = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

export interface DailyActivityPoint {
  date: string
  ALLOW: number
  WARN: number
  REDACT: number
  BLOCK: number
}

export interface RiskDistributionPoint {
  risk: Risk
  count: number
}

export interface DetectorCount {
  detector: string
  count: number
}

export interface WebsiteUsagePoint {
  website: string
  count: number
}

export interface DepartmentUsagePoint {
  department: string
  count: number
}

export interface RecentActivityItem {
  id: string
  employee_name: string
  employee_email: string
  website: string
  action: Action
  risk: Risk
  score: number
  created_at: string
}

export interface FileTypeBreakdownPoint {
  extension: string
  count: number
}

export interface FileCategoryPoint {
  category: string
  count: number
}

export interface FileScanStats {
  total_files_scanned: number
  blocked_uploads: number
  file_type_breakdown: FileTypeBreakdownPoint[]
  top_sensitive_categories: FileCategoryPoint[]
}

export interface DashboardSummary {
  security_score: number
  total_prompts: number
  allowed: number
  warned: number
  redacted: number
  blocked: number
  active_employees: number
  protected_websites: number
  daily_activity: DailyActivityPoint[]
  risk_distribution: RiskDistributionPoint[]
  top_violations: DetectorCount[]
  website_usage: WebsiteUsagePoint[]
  department_usage: DepartmentUsagePoint[]
  recent_activity: RecentActivityItem[]
  file_stats: FileScanStats
}

export interface RiskTrendPoint {
  date: string
  average_risk_score: number
}

export interface TopEmployeeViolation {
  full_name: string
  email: string
  department: string | null
  violation_count: number
}

export interface AnalyticsSummary {
  daily_activity: DailyActivityPoint[]
  blocked_vs_allowed: Record<string, number>
  risk_trend: RiskTrendPoint[]
  top_triggered_rules: DetectorCount[]
  website_usage: WebsiteUsagePoint[]
  department_usage: DepartmentUsagePoint[]
  top_employees_by_violations: TopEmployeeViolation[]
  file_stats: FileScanStats
}

export interface PromptLogListItem {
  id: string
  employee_name: string
  employee_email: string
  website: string
  risk: Risk
  score: number
  action: Action
  status: "Clean" | "Flagged"
  created_at: string
  has_files: boolean
  file_count: number
}

export interface FileFinding {
  filename: string
  extension: string
  category: string
  size_bytes: number | null
  mime_type: string | null
  risk: Risk
  score: number
  extracted: boolean
  extraction_note: string | null
}

export interface PromptLogListResponse {
  items: PromptLogListItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface TriggeredRuleDetail {
  detector: string
  severity: Risk
  score: number
  reason: string
}

export interface PromptLogDetail {
  id: string
  employee_name: string
  employee_email: string
  department: string | null
  website: string
  risk: Risk
  score: number
  action: Action
  reason: string
  triggered_policy: string | null
  original_prompt: string
  sanitized_prompt: string
  triggered_rules: TriggeredRuleDetail[]
  created_at: string
  files: FileFinding[]
}

export interface Policy {
  id: string
  name: string
  description: string
  priority: number
  detection_type: string
  action: Action
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface PolicyInput {
  name: string
  description: string
  priority: number
  detection_type: string
  action: Action
  enabled: boolean
}

export interface EmployeeListItem {
  id: string
  full_name: string
  email: string
  department: string | null
  role: string
  prompt_count: number
  violation_count: number
  last_active: string | null
  extension_status: "active" | "inactive" | "not_installed"
}

export interface EmployeeListResponse {
  items: EmployeeListItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface OrgSettings {
  organization_name: string
  risk_threshold: number
  supported_websites: string[]
  allowed_file_types: string[]
  theme_default: "light" | "dark"
}

export interface CompanyKeyword {
  id: string
  keyword: string
  enabled: boolean
}
