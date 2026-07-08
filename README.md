# PromptShield AI

**The AI firewall for teams using ChatGPT, Claude & Gemini.**

PromptShield AI is an enterprise-grade AI firewall made of three parts that
work together: a Chrome extension that inspects every prompt — and every
file — an employee sends to a public AI tool, a FastAPI backend with a
multi-stage detection pipeline that decides what happens to that content,
and a React admin dashboard where security teams configure policy and
watch it all happen live. It was built as a hackathon MVP — no
placeholders, no mock data, every screen backed by a real MySQL database.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [File Scanning](#file-scanning)
4. [Architecture](#architecture)
5. [Tech Stack](#tech-stack)
6. [Screenshots](#screenshots)
7. [Installation](#installation)
8. [Running the Backend](#running-the-backend)
9. [Running the Admin Dashboard](#running-the-admin-dashboard)
10. [Loading the Browser Extension](#loading-the-browser-extension)
11. [Creating the MySQL Database](#creating-the-mysql-database)
12. [Environment Variables](#environment-variables)
13. [Demo Credentials](#demo-credentials)
14. [Project Structure](#project-structure)
15. [Known Limitations](#known-limitations)
16. [Production Hardening (Milestone 6)](#production-hardening-milestone-6)
17. [File Scanning Hardening](#file-scanning-hardening)
18. [Manual Test Checklist](#manual-test-checklist)
19. [Future Scope](#future-scope)

---

## Project Overview

Employees don't stop using ChatGPT, Claude, or Gemini just because IT asks
them to — and they don't stop attaching files to those conversations
either. PromptShield AI accepts that reality and puts a firewall in the
one place that matters: the moment a prompt or a file is about to leave
the browser.

- **Browser Extension** — a Manifest V3 extension that sits quietly inside
  `chatgpt.com`, `chat.openai.com`, `claude.ai`, and `gemini.google.com`.
  It intercepts the prompt textbox on submit *and* the file picker/
  drag-and-drop flow, sends the text and any attached files to the
  backend, and enforces whatever decision comes back — before the AI site
  ever sees the original content.
- **FastAPI Backend** — a single `POST /api/scan` endpoint runs the prompt
  and every attached file through the same detection pipeline (normalizer
  → regex → Presidio → spaCy → source-code detector → company keyword
  matcher → detect-secrets → file-identity risk → policy engine → risk
  engine → decision engine → redactor), logs the result to MySQL, and
  returns one of four decisions per prompt **and per file**: **ALLOW**,
  **WARN**, **REDACT**, or **BLOCK**.
- **Admin Dashboard** — a React console where security teams see every
  scanned prompt and every scanned file, author detection policies, track
  employee risk, and read analytics — all computed live from the same
  `audit_logs` table the extension writes to.

No Redis, no Kafka, no Docker, no Kubernetes, no Elasticsearch. Just
FastAPI, MySQL, and two Vite-built frontends.

## Features

**Detection Engine**
- Regex detection for emails, phone numbers, URLs, AWS/GitHub/OpenAI keys, JWTs, and more.
- Microsoft Presidio for PII (names, locations, credit cards, and other entities).
- spaCy NER as a second-opinion entity detector.
- `detect-secrets` for live credentials (API keys, private keys, tokens) using a curated,
  deterministic plugin set — entropy-based plugins are deliberately excluded (see
  [Known Limitations](#known-limitations)).
- Source-code detector (flags Python/JavaScript/SQL/etc. pasted into a prompt or a file).
- Company keyword matcher against an admin-configurable keyword list.
- **File Scanning** — every attached file is text-extracted and run through the exact same
  detectors above (no duplicated detection logic), plus a dedicated file-identity risk check
  for inherently dangerous file types (`.env`, private keys, `docker-compose.yml`, ...). See
  [File Scanning](#file-scanning) below for the full picture.
- A policy engine that maps any detection category — from either a prompt or a file — to
  `ALLOW` / `WARN` / `REDACT` / `BLOCK`, evaluated in admin-defined priority order.
- A risk engine that aggregates every detector's findings into one risk score and severity.

**Browser Extension**
- Custom React UI rendered inside a closed Shadow DOM — no `alert()`/`confirm()`, ever.
- An **Explainable AI panel** on every WARN/BLOCK: overall risk score, each individual
  finding, the policy that fired, the recommended action, and a plain-language reason. When
  files are attached, findings are grouped **per file** so it's immediately clear which
  attachment triggered what, instead of one jumbled combined list.
- WARN shows a modal with Cancel/Continue. REDACT rewrites the prompt in place and requires
  the employee to manually re-send (no silent auto-resubmit). BLOCK stops submission outright.
- File uploads are gated **per file, not all-or-nothing**: in a multi-file selection, clean
  files upload automatically while only the flagged/blocked ones are held back for review.
- Hardened site adapters with multiple selector fallback strategies, MutationObserver +
  polling + SPA-navigation detection so it keeps working as ChatGPT/Claude/Gemini update
  their DOM.
- Popup shows signed-in user, derived organization, live backend connectivity, a
  protection on/off switch, and the last scan result — scoped to whichever account is
  currently signed in, so switching accounts never shows a stale scan from someone else.

**Admin Dashboard**
- **Dashboard** — security score, prompt/violation counters, daily activity chart, risk
  distribution, top violation types, website usage, a live recent-activity feed, plus
  files-scanned/blocked-uploads counters and file-type/sensitive-category breakdowns.
- **Prompt Logs** — searchable, filterable, paginated table with a detail drawer showing
  both the original and sanitized prompt, every detector finding, the triggered policy, and
  (when present) the attached files with their own per-file risk, action, and findings.
- **Policies** — full CRUD with priority ordering, detection-type mapping (including
  file-specific categories like `env_file`, `credentials_file`, `source_code_file`), and an
  enable/disable toggle.
- **Employees** — directory with department, role, prompt volume, violation count, and a
  live "last active" / "extension status" computed from real scan activity.
- **Analytics** — risk trends, department breakdowns, website usage, and file-scanning
  trends over time.
- **Settings** — organization name, risk threshold, supported websites, the company
  keyword list, and the full set of allowed file upload types (grouped by category), all
  persisted to MySQL.

## File Scanning

Files are a second attack surface alongside typed prompts, so PromptShield AI treats a file
upload exactly like a prompt: extract its text, then run that text through the **same**
detector stages the prompt goes through — nothing is duplicated.

**How it works, end to end**

1. **Interception** — the content script intercepts both the native `<input type="file">`
   picker (`change` events) and drag-and-drop (`drop` events) at the document capture phase,
   before the AI site's own upload handler ever runs, using the same
   intercept-then-replay-if-clean pattern already used for prompt submission.
2. **Extraction** — `ai/file_scanner.py` decodes the file and extracts plain text via a small
   extension → extractor registry, so adding a new format is a one-line addition, not a new
   code path:

   | Category | Extensions |
   |---|---|
   | Documents | `pdf`, `docx`, `txt` |
   | Source code | `java`, `py`, `js`, `jsx`, `ts`, `tsx`, `cpp`, `cc`, `cxx`, `h`, `hpp`, `c`, `cs`, `go`, `rs`, `php`, `html`, `htm`, `css`, `sql` |
   | Configuration | `env`, `properties`, `yaml`, `yml` (incl. `docker-compose.yml`), `json`, `xml` |
   | Data | `csv`, `xlsx` |
   | Logs | `log` |
   | Images (OCR) | `png`, `jpg`, `jpeg` — via `pytesseract` + the system `tesseract` binary |

3. **Detection** — the extracted text is fed through the identical normalizer → regex →
   Presidio → spaCy → source-code → company-keyword → detect-secrets chain used for prompts.
   A dedicated `ai/file_risk.py` detector additionally scores the file's *identity* — its
   name and extension — independent of content, so something like a bare `.env` or `id_rsa`
   is flagged even if its content happens to extract as empty. An org-configurable denylist
   (Settings → Allowed File Types) blocks disallowed extensions before any content is
   extracted at all.
4. **Per-file decision** — every file gets its **own independent** `ALLOW`/`WARN`/`REDACT`/
   `BLOCK` action from the same policy + risk + decision engines used for the overall scan,
   scoped to just that file's findings. This is what actually gates the upload: in a
   multi-file selection, files that come back clean are replayed into the page automatically,
   while only the flagged or blocked ones are held back in a review modal — one bad file
   never blocks the rest of the batch.
5. **Unified prompt verdict** — separately, the top-level `ScanResponse.decision` still
   reflects the combined risk of the prompt text plus all files, which is what governs
   whether the prompt itself gets redacted or held for a WARN confirmation.
6. **Audit trail** — `audit_logs` records file **metadata only** (filename, extension,
   category, size, mime type, risk, score, which detectors fired, per-file action/reason) —
   raw file content is never persisted.

This design means image OCR, ZIP/archive support, or any future format only ever needs a new
entry in the extractor registry — the detection, scoring, policy, and audit layers require no
changes.

## Architecture

```
  Browser Extension (Manifest V3)          Admin Dashboard (React + Vite)
  ChatGPT / Claude / Gemini adapters       Live security console
  Intercepts prompt submit + file picker/  |
  drag-drop                                |
            |                                          |
            |  POST /api/scan (prompt + files)         |  /api/dashboard, /api/prompt-logs,
            |  <- ALLOW / WARN / REDACT / BLOCK         |  /api/policies, /api/employees, ...
            |     (+ one action per file)               |
            v                                          v
  +----------------------------------------------------------------+
  |                        FastAPI Backend                         |
  |  Prompt text ---------------------------+                      |
  |  File(s) -> ai/file_scanner.py (extract) |                      |
  |                                          v                      |
  |  Normalizer -> Regex -> Presidio -> spaCy -> Source Code ->     |
  |  Company Keyword -> detect-secrets -> File Identity Risk ->     |
  |  Policy Engine -> Risk Engine -> Decision Engine                |
  |    (once for the unified prompt+files verdict,                  |
  |     once per file for its own independent action)               |
  |  -> Redactor -> Audit Logger                                    |
  +--------------------------------|---------------------------------+
                                    v
                        +-----------------------+
                        |       MySQL 8.4        |
                        |  users, audit_logs      |
                        |   (+ file metadata),     |
                        |  policies,                |
                        |  company_keywords,         |
                        |  org_settings                |
                        +-----------------------+
```

Every detector returns the same `DetectionResult` shape (`detector`,
`severity`, `score`, `matches`, `recommendation`, `reason`), whether it ran
over prompt text or extracted file text — so the risk engine aggregates
across every stage without special-casing prompts vs. files. See
`docs/SYSTEM_ARCHITECTURE.md` and `docs/API_DOCUMENTATION.md` for the full
breakdown.

## Tech Stack

| Component | Stack |
|---|---|
| Backend | FastAPI 0.115, SQLAlchemy 2.0, Pydantic v2, PyMySQL, python-jose (JWT), Passlib+bcrypt |
| Detection Engine | spaCy, Presidio Analyzer/Anonymizer, detect-secrets, langdetect |
| File Scanning | pypdf (PDF), python-docx (Word), openpyxl (Excel), Pillow + pytesseract (image OCR, requires system `tesseract`), PyYAML |
| Database | MySQL 8.4 (no Alembic — `Base.metadata.create_all()` on startup) |
| Admin Dashboard | React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query, Recharts, Framer Motion, React Router |
| Browser Extension | Manifest V3, React 19, Vite, TypeScript, Tailwind CSS v4 |

## Screenshots

_Add screenshots of the running dashboard and extension here before sharing this README:_

- `docs/screenshots/dashboard.png` — Dashboard overview
- `docs/screenshots/prompt-logs.png` — Prompt Logs table + detail drawer
- `docs/screenshots/policies.png` — Policy editor
- `docs/screenshots/extension-warn.png` — Extension WARN modal with Explainable AI panel
- `docs/screenshots/extension-block.png` — Extension BLOCK modal

## Installation

**Prerequisites**

- Python 3.10+
- Node.js 20+
- MySQL 8.4 (running locally or reachable over the network)
- Google Chrome (or any Chromium-based browser) for the extension

Clone the repository, then set up each of the three components as described below.

## Running the Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Optional but recommended - improves PII/NER detection accuracy:
python -m spacy download en_core_web_sm

cp .env.example .env             # then edit .env - see Environment Variables below
python seed.py                   # creates the admin user, demo org, and ~260 sample logs
uvicorn main:app --reload --port 8000
```

The API is now live at `http://localhost:8000`. Interactive docs are at
`http://localhost:8000/docs`.

## Running the Admin Dashboard

```bash
cd admin-dashboard
npm install
npm run dev
```

Open `http://localhost:5173`. Sign in with the [demo credentials](#demo-credentials)
below, or visit `/` for the marketing landing page.

## Loading the Browser Extension

```bash
cd browser-extension
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `browser-extension/dist`.
4. Open the extension popup and sign in with the same credentials as the dashboard.
5. Visit `chatgpt.com`, `claude.ai`, or `gemini.google.com` and send a prompt, or attach a
   file — PromptShield scans both before either reaches the site.

## Creating the MySQL Database

```sql
CREATE DATABASE promptshield CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'promptshield'@'localhost' IDENTIFIED BY 'change-this-password';
GRANT ALL PRIVILEGES ON promptshield.* TO 'promptshield'@'localhost';
FLUSH PRIVILEGES;
```

Point `backend/.env` at this database (see below) and run `python seed.py` — the backend
creates every table automatically on first run via SQLAlchemy's metadata, no migration
tool required.

## Environment Variables

`backend/.env` (copy from `backend/.env.example`):

| Variable | Description | Example |
|---|---|---|
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_NAME` | Database name | `promptshield` |
| `DB_USER` | Database user | `root` |
| `DB_PASSWORD` | Database password | `changeme` |
| `JWT_SECRET_KEY` | Secret used to sign access tokens — **change this in production** | a long random string |
| `JWT_ALGORITHM` | JWT signing algorithm | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime | `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Reserved for a future refresh-token endpoint | `7` |
| `ENVIRONMENT` | `development` or `production` | `development` |
| `CORS_ORIGINS` | Comma-separated list of allowed origins (dashboard + extension) | `http://localhost:5173,chrome-extension://*` |
| `OPENROUTER_API_KEY` | Optional — enables the semantic classifier detector | _(blank disables it gracefully)_ |

## Demo Credentials

Running `python seed.py` creates a demo organization with:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@promptshield.ai` | `Admin@12345` |
| Any seeded employee (e.g. Priya Sharma) | `priya.sharma@acme.com` | `Employee@12345` |

The seed also creates 20 employees across 10 departments, 5 default policies, 5 company
keywords, and ~260 realistic prompt-scan log entries spread across the last 30 days, so the
dashboard looks alive immediately.

## Project Structure

```
firewall appln/
├── backend/
│   ├── ai/                  # Detection engine: normalizer, detectors, file_scanner.py (extraction),
│   │                        #   file_risk.py (file-identity risk), risk/policy/decision engines,
│   │                        #   redactor, pipeline.py (orchestrator)
│   ├── auth/                 # Password hashing, JWT issuing, dependencies (require_admin, etc.)
│   ├── config/                # Pydantic settings
│   ├── middleware/             # Request logging
│   ├── models/                  # SQLAlchemy models (User, Policy, CompanyKeyword, AuditLog incl.
│   │                             #   file metadata, OrgSettings incl. allowed_file_types)
│   ├── routers/                  # auth, health, scan, dashboard, analytics, prompt_logs, policies, employees, settings
│   ├── schemas/                    # Pydantic request/response schemas (scan.py incl. FileFindingSummary)
│   ├── services/                    # Business logic shared by routers (analytics, employees, settings, audit, policy)
│   ├── seed.py                       # Demo data seeder (idempotent)
│   ├── main.py                        # FastAPI app entrypoint
│   └── requirements.txt
├── admin-dashboard/
│   └── src/
│       ├── components/        # Shared UI (Button, Card, Drawer, Pagination, EmptyState, ErrorState, Logo, ...)
│       ├── context/             # Auth + Theme providers
│       ├── lib/                   # adminApi.ts (typed API client), format.ts
│       ├── pages/                   # LandingPage, LoginPage, Dashboard/PromptLogs/Policies/Employees/Analytics/Settings
│       │                           #   (Dashboard/Analytics show file-scan stats; PromptLogs shows attached files;
│       │                           #   Settings manages allowed file types by category), NotFoundPage
│       └── types/                     # TS mirrors of backend Pydantic schemas
├── browser-extension/
│   ├── public/                # manifest.json, icons/
│   ├── scripts/                 # generate_icons.py (regenerates toolbar icons from the brand mark)
│   └── src/
│       ├── adapters/              # Per-site DOM adapters (ChatGPT, Claude, Gemini)
│       ├── background/              # Service worker: JWT expiry, health polling, protection toggle,
│       │                             #   per-account last-scan tracking
│       ├── content/                   # Content script + React UI: modals, toast, Explainable AI panel
│       │                             #   (per-file grouped findings), FileReviewModal (partial-upload review)
│       ├── popup/                       # Extension popup UI
│       ├── services/                      # api.ts, theme.ts
│       └── utils/                           # dom.ts, jwt.ts, labels.ts, org.ts, files.ts (file-picker/
│                                             #   drag-drop interception + replay helpers)
└── docs/                          # SYSTEM_ARCHITECTURE.md, DATABASE_SCHEMA.md, API_DOCUMENTATION.md,
                                    # EXTENSION_ARCHITECTURE.md, BUSINESS_MODEL.md, PROJECT_STRUCTURE.md
```

## Known Limitations

- **spaCy / Presidio NER model**: `en_core_web_sm` could not be downloaded in the sandbox
  this project was built in (its GitHub release host was blocked by the sandbox's network
  proxy). Both detectors degrade gracefully to a neutral no-op result when the model is
  missing rather than crashing — run `python -m spacy download en_core_web_sm` on your own
  machine to enable full PII/NER detection.
- **`detect-secrets` entropy plugins are intentionally disabled**: testing showed
  Base64/Hex high-entropy plugins flag ordinary English words (e.g. "banana") as secrets.
  The secret detector uses a curated set of 24 deterministic, pattern-based plugins instead
  (AWS keys, GitHub/GitLab tokens, private keys, Slack/Stripe/Twilio tokens, and more).
- **No refresh-token endpoint**: the extension detects JWT expiry client-side (decoding the
  token payload) and prompts a clean re-login rather than silently refreshing, since the
  backend intentionally does not implement token refresh in this MVP.
- **Semantic classifier is optional**: the OpenRouter-based semantic classifier only runs
  if `OPENROUTER_API_KEY` is set; without it, the other eight detection stages still run
  normally.
- **Single-tenant demo data**: the seeded "Demo Organization" data is for local evaluation
  only — there is no multi-tenant isolation in this MVP (see [Future Scope](#future-scope)).
- **JWT stored in `chrome.storage.local`**: this is plaintext, on-disk storage - the only
  practical option for a Manifest V3 extension without a native messaging host. Reviewed as
  part of Milestone 6's security pass and accepted as a platform constraint rather than a
  fixable bug; a shorter access-token lifetime is the main lever available without a bigger
  architecture change.
- **Rate limiting is in-memory, single-instance**: `POST /api/auth/login` and `/register`
  are throttled per-IP (10 attempts/minute) to blunt brute-force attempts, but the limiter's
  state lives in the FastAPI process's memory - a multi-instance production deployment
  behind a load balancer would need this backed by a shared store (Redis) instead, which is
  out of scope for this MVP's "no Redis" constraint.
- **Uncaught 500s have no external alerting**: FastAPI's default exception handling never
  leaks stack traces to the client, and unhandled exceptions are now logged with full
  tracebacks (see `middleware/logging.py`), but there's no Sentry/observability integration
  in this MVP - a real deployment would want one.
- **Image OCR needs a system dependency**: `.png`/`.jpg`/`.jpeg` extraction uses
  `pytesseract`, which shells out to the `tesseract` binary (`apt-get install tesseract-ocr`
  on Debian/Ubuntu). If it's missing, that one file's extraction fails gracefully with a
  clear reason in `FileFindingSummary.extraction_note` instead of crashing the scan — the
  file's identity-based risk check (`ai/file_risk.py`) still runs regardless.
- **No ZIP/archive or nested-file support yet**: uploading a `.zip` is rejected by the
  allowed-file-types denylist rather than unpacked and scanned recursively — see
  [Future Scope](#future-scope). The extractor-registry design in `ai/file_scanner.py` was
  built specifically so this can be added later without touching detection/policy/audit code.

## Production Hardening (Milestone 6)

After Milestones 1-5 shipped a feature-complete hackathon MVP, a full staff-engineer-level
review of the codebase (backend, dashboard, extension, database, security, accessibility)
found and fixed several real issues rather than adding new features:

- Closed a **critical privilege-escalation bug**: `POST /api/auth/register` used to accept
  a client-supplied `role` field, letting anyone self-register as an admin. Public
  registration now always creates a plain employee account.
- Added **fault isolation** to the detection pipeline so one detector's unexpected exception
  degrades to a neutral result instead of crashing the whole scan (and losing the audit log
  entry for a legitimate prompt).
- Added **file-upload size/count limits** on `/api/scan` (max 5 files, ~10MB each) to close
  a memory-exhaustion DoS vector.
- Fixed the extension's `scanPrompt()` **silently failing open on an expired session** (401)
  exactly the same as a healthy "nothing to flag" response - it now clears the stale session
  so the employee is prompted to re-authenticate instead of unknowingly running unprotected.
- Fixed `User.extension_status` being **permanently stale** on `/api/auth/me` (always
  `not_installed`) while `/api/employees` computed it correctly - both now compute it live.
- Added **indexes** on `audit_logs.website/action/risk` (see `docs/DATABASE_SCHEMA.md`) and
  **rate limiting** on the login/register endpoints.
- **Debounced** the Prompt Logs and Employees search inputs (were firing a network request
  on every keystroke).
- Gave the Drawer, ConfirmDialog, and PolicyFormModal components consistent **keyboard
  navigation and screen-reader semantics** (`role`/`aria-*`, focus trapping, Escape-to-close,
  focus restored on close) via one shared `useDialogA11y` hook, instead of each
  reimplementing a different partial subset.
- Removed a **duplicated `SEVERITY_RANK` dict** that was copy-pasted into five detector
  files, extracting it into `schemas/detection.py` once.

## File Scanning Hardening

After File Scanning shipped, a second pass fixed a few real-world rough edges found while
actually uploading files through the extension:

- Fixed files being **auto-blocked purely by extension**, even with harmless content (e.g. a
  `dump.sql` containing only `SELECT * FROM users;`). Root cause was two-fold: an
  already-created `org_settings` row still had the original, narrower default
  `allowed_file_types` list, and the Settings page's file-type constant was hardcoded to the
  same old list, so newer types could never even be enabled through the UI. Both are now
  driven from the same up-to-date extension list, grouped by category in Settings.
- Replaced **all-or-nothing multi-file gating** with **per-file gating**: previously, if any
  one file in a batch was flagged, none of the files uploaded. Each file now gets its own
  independent action (`ai/pipeline.py` re-runs the policy/decision engines scoped to that
  file's own findings), so clean files upload immediately and only the flagged/blocked ones
  are held back in a review modal.
- Replaced the **flat, combined findings list** with **per-file grouping** in the Explainable
  AI panel: when several files are attached and, say, two of them each contain a different
  secret, the panel now shows a card per file with that file's own risk badge and findings,
  instead of mixing every detector hit from every file into one undifferentiated list.
- Fixed the extension popup's **"Last scan" time leaking across accounts**: `last_scan` was
  stored under a single global `chrome.storage.local` key with no notion of which account it
  belonged to, so logging in as a different user in the same browser would show the
  *previous* account's last scan time, site, and decision. It's now cleared on every login,
  logout, and expired/invalid-session event, so each signed-in account only ever sees its own
  scan history.

## Manual Test Checklist

Automated tests cover the API end-to-end (SQLite-backed FastAPI `TestClient` runs), but the
extension's real-world DOM behavior should be spot-checked by hand after any change:

- [ ] On `chatgpt.com`: send a benign prompt → **ALLOW**, prompt goes through unmodified.
- [ ] On `chatgpt.com`: send a prompt containing a company keyword → **WARN** modal appears
      with Cancel/Continue; Continue re-sends the original text.
- [ ] On `claude.ai`: send a prompt with an email + phone number → **REDACT** rewrites the
      textbox; prompt is *not* auto-sent — you must click Send yourself.
- [ ] On `gemini.google.com`: send a prompt with a fake AWS key → **BLOCK** modal appears;
      confirm the network tab shows the request never reached the AI site's own backend.
- [ ] Every WARN/BLOCK modal shows the Explainable AI panel (risk score, findings, triggered
      policy, recommended action, reason) — not a generic error.
- [ ] Reload the extension mid-conversation and confirm the content script reconnects
      without a full page refresh.
- [ ] Toggle protection off in the popup and confirm prompts pass through unscanned; toggle
      it back on.
- [ ] Switch the dashboard/extension theme and confirm both stay in sync via
      `chrome.storage`.
- [ ] Attach a plain `.sql`/`.py` file with no sensitive content → uploads through
      automatically (no false block purely from file type).
- [ ] Attach a `.env` file (or one named `id_rsa`) → **BLOCK**, file is not uploaded, and the
      review modal explains why.
- [ ] Select 3+ files at once where only one contains a secret → the clean files upload
      immediately; only the flagged file appears in the review modal, grouped under its own
      filename with its own findings.
- [ ] Sign in as one account, trigger a scan, then sign out and sign in as a different
      account → the popup's "Last scan" is empty/reset, not showing the previous account's
      result.

## Future Scope

- Multi-tenant organizations with SSO/SAML.
- A refresh-token endpoint and silent session renewal.
- Firefox/Edge extension builds, plus adapters for Gmail, Outlook, Teams, and Slack.
- SIEM export (Splunk/Datadog) and webhook alerting on BLOCK events.
- Fine-grained per-department policy overrides.
- ZIP/archive extraction (recursively scan files inside an archive before allowing upload).
- A managed cloud offering alongside the self-hosted deployment described in this README.

See `docs/BUSINESS_MODEL.md` for the full roadmap and go-to-market plan.

---

© 2026 PromptShield AI. Built as a hackathon MVP for enterprise AI governance.
