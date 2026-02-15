# Foxhole for Claude — Firefox Extension

## Architecture

Firefox WebExtension (Manifest V2) with four layers:

| Layer | Path | Role |
|-------|------|------|
| Background | `background/` | Claude API calls, tool routing, site knowledge, prompt injection defense |
| Content script | `content/content.js` | Executes in page context (DOM, screenshots, clicks, cleaned page content) |
| Sidebar | `sidebar/` | Chat UI, toolbar, modals, tab management, streaming renderer |
| Options | `options/` | Settings page (API key, model, high-risk tools) |

## Key Files

| File | Role |
|------|------|
| `background/background.js` | Message hub, conversation loop, context compression, auto-continue |
| `background/tools.js` | All tool definitions sent to Claude API |
| `background/tool-router.js` | Tool execution dispatch + handlers (including `save_site_spec`, `delete_site_spec`) |
| `background/site-knowledge.js` | Per-domain spec storage, staleness badges, profile rendering, prompt formatting |
| `background/system-prompt.txt` | Claude's system prompt — assistant philosophy, rules, site knowledge, discovery |
| `background/content-sanitizer.js` | Prompt injection detection — marks suspicious patterns in page content |
| `background/claude-api.js` | API client with retry logic (429/500/502/503/529 with backoff) |
| `background/prompt-loader.js` | Loads and caches system prompt from `.txt` file |
| `background/api-observer.js` | Passive network request observer — records API patterns per domain |
| `background/interaction-observer.js` | Passive DOM interaction observer — records working selectors per domain |
| `sidebar/sidebar.js` | Main sidebar logic, token tracking, event wiring |
| `sidebar/modules/stream-renderer.js` | Streaming display, message finalization (response text above activity log) |
| `sidebar/modules/activity-log.js` | Collapsible tool call display, HTML conversion button |
| `sidebar/modules/modal-manager.js` | All modals (confirmation, API key, shortcuts) |
| `sidebar/modules/tab-manager.js` | Per-tab conversation/state management |

## Core Design: Assistant, Not Automation

The extension is a browser **assistant** — Claude helps the user interact with pages, it does not run unattended automation. Key implications:

- **Delegate to the user** when one click beats five tool calls (age gates, login, CAPTCHAs, location selectors)
- **Escalate on failure** — don't silently try alternative approaches after a state change fails
- **First-visit discovery** — on new sites, probe DOM for framework + check API observer before guessing

This philosophy is enforced in `system-prompt.txt` rules 5 and 6.

## Site Knowledge System

Persistent per-domain specs stored in `browser.storage.local`, injected into Claude's system prompt on every request.

### Spec types

| Type | Purpose | Cardinality |
|------|---------|-------------|
| `profile` | Site interaction model (UI-ONLY / API / HYBRID) | One per domain (auto-updated) |
| `dom` | CSS selectors | Many |
| `api` | Endpoints | Many |
| `storage` | localStorage/cookie keys | Many |
| `shortcut` | Multi-step workflows | Many |

### Staleness

Specs get age badges in prompt formatting (`site-knowledge.js:formatForPrompt`):
- **< 3 weeks** — no badge, use confidently
- **3-8 weeks** — `[aging]`
- **> 2 months** — `[STALE — verify before using]`

Each spec shows its `spec_id` so Claude can delete broken ones with `delete_site_spec`.

### Profile rendering

Profile specs render first, above all other specs, in a box-drawing border with no code fence (raw text for readability).

## Prompt Injection Defense

Three layers:

1. **Content cleaning** (`content.js:getCleanedPageContent`) — strips hidden elements, scripts, styles, comments, `aria-hidden` nodes before returning HTML to Claude
2. **Pattern detection** (`content-sanitizer.js`) — wraps instruction overrides, role impersonation, fake urgency, fake tool markup, data exfiltration attempts in `[SUSPICIOUS:LABEL]` markers
3. **Page content markers** (`background.js`) — page-reading tool results wrapped in `[PAGE_CONTENT_START]`/`[PAGE_CONTENT_END]` so Claude treats them as data, not instructions

## Context Compression

Three-tier system in `background.js`:

1. **Progressive** (every call) — strips screenshots from turns >2 old, replaces tool results >500 chars in turns >4 old with semantic summaries
2. **Basic** (`compressConversationHistory`) — replaces all large tool results with semantic summaries
3. **Aggressive** (at 60% context threshold) — summarizes old turns into compressed history block, keeps last 4 turns

Tool results are stamped with `[TOOL_SUMMARY] [toolName] description...` at creation time so compression extracts semantic summaries instead of truncating raw data.

## System Prompt Structure

Built in `background.js:buildSystemPrompt()`. Two blocks sent to the API:

1. **Dynamic context** (first, cached per domain) — site knowledge, API observer patterns, DOM interaction patterns, autonomy mode
2. **Static base prompt** (second, cached) — loaded from `system-prompt.txt`

Dynamic context comes first so Claude reads site knowledge before the instructions that reference it.

## Permission Model

Two modes controlled by autonomy dropdown in toolbar:

- **"Confirm risky actions"** (default) — high-risk tools show confirmation modal
- **"Skip all confirmations"** — everything auto-executes

Logic: `needsConfirmation = mode === 'ask' && isHighRisk`

## Message Layout

In `stream-renderer.js:finalizeMessage()`, the DOM order is:

1. Response text (the useful output — front and center)
2. Activity log (collapsible tool calls — below, expandable if curious)

## Conventions

- No build step — raw JS/CSS/HTML loaded directly by Firefox
- Manifest version must be pure numeric `major.minor.patch` — Firefox rejects suffixes like `-dev` or `-beta`
- `develop` branch is always one minor version ahead of `master`
- State stored in `browser.storage.local`
- CSS uses custom properties defined in `:root` in `sidebar.css`
- No generic `.hidden` utility class — use scoped `.modal.hidden` or `style.display`
- Token display has visual tiers at 50k/100k/150k cumulative tokens
- Welcome screen defined in both `sidebar.html` (initial load) and `tab-manager.js:getWelcomeMessageHtml()` (tab switch) — keep in sync
- Any tool returning `result.screenshot` (a data URL) gets converted to a Claude vision image block in `background.js` — universal image pipeline
- Screenshots stored in `docs/screenshots/`, named with numeric prefix for sort order
- Spec content is backtick-escaped (`\u200B`) at save time to prevent code fence breakout in prompt formatting

## Testing

No automated tests. Manual testing in Firefox via `about:debugging` > Load Temporary Add-on.
