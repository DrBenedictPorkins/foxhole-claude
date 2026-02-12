# Foxhole for Claude — Firefox Extension

## Architecture

Firefox WebExtension (Manifest V2) with four layers:

| Layer | Path | Role |
|-------|------|------|
| Background | `background/` | Claude API calls, tool routing, site knowledge storage |
| Content script | `content/content.js` | Executes in page context (DOM, screenshots, clicks) |
| Sidebar | `sidebar/` | Chat UI, toolbar, modals, tab management |
| Options | `options/` | Settings page (API key, model, high-risk tools) |

## Key Files

- `background/background.js` — Message hub, confirmation logic, conversation loop
- `background/tools.js` — All 72 tool definitions sent to Claude API
- `background/tool-router.js` — Tool execution dispatch + handlers
- `background/site-knowledge.js` — Per-domain spec storage, prompt injection, formatting
- `background/system-prompt.txt` — Claude's system prompt (loaded at runtime)
- `sidebar/sidebar.js` — Main sidebar logic, token tracking, event wiring
- `sidebar/modules/modal-manager.js` — All modals (confirmation, API key, shortcuts)
- `sidebar/modules/tab-manager.js` — Per-tab conversation/state management

## Permission Model

Two modes controlled by autonomy dropdown in toolbar:

- **"Confirm risky actions"** (default) — High-risk tools show confirmation modal
- **"Skip all confirmations"** — Everything auto-executes, no prompts

Logic in `background.js`: `needsConfirmation = mode === 'ask' && isHighRisk`

## Conventions

- No build step — raw JS/CSS/HTML loaded directly by Firefox
- Manifest version must be pure numeric `major.minor.patch` — Firefox rejects suffixes like `-dev` or `-beta`
- State stored in `browser.storage.local`
- CSS uses custom properties defined in `:root` in `sidebar.css`
- No generic `.hidden` utility class — use scoped `.modal.hidden` or `style.display`
- Token display has visual tiers at 50k/100k/150k cumulative tokens
- Welcome screen is defined in both `sidebar.html` (initial load) and `tab-manager.js:getWelcomeMessageHtml()` (tab switch) — keep them in sync
- Any tool returning `result.screenshot` (a data URL) gets converted to a Claude vision image block in `background.js` — this is the universal image pipeline
- Screenshots stored in `docs/screenshots/`, named with numeric prefix for sort order (e.g., `01-welcome.jpg`)

## Testing

No automated tests. Manual testing in Firefox via `about:debugging` → Load Temporary Add-on.
