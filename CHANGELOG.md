# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-02-11

### Added
- `read_image` tool — fetch page images by CSS selector or URL for Claude vision analysis (canvas approach with CORS fetch fallback)
- Multi-image queue — screenshots and pasted images accumulate instead of overwriting; grid preview with per-image remove buttons
- `take_element_screenshot` and `read_image` summarizers for conversation history
- "View full payload" link in confirmation modal — opens formatted read-only popup window for large payloads
- README screenshots documenting welcome screen, permission model, and security audit workflow

### Changed
- Confirmation modal renders tool params as labeled blocks instead of raw JSON dump; multi-line values (code) display with real line breaks
- Generalized image pipeline — any tool returning `result.screenshot` is converted to a vision block (fixes `take_element_screenshot` which previously fell through to text serialization)

## [1.3.0] - 2026-02-10

### Added
- Token usage animation — display pulses on each update with color tiers (amber at 50k, red at 150k)
- Project `CLAUDE.md` with architecture overview and development conventions
- Security Audit preset prompt on welcome screen

### Changed
- Redesigned permission model: "Confirm risky actions" / "Skip all confirmations" replaces old labeling, modeled after Claude Code's permission pattern
- Skip-all-confirmations shortcut in confirmation modal with two-click safety flow
- Site knowledge `save_site_spec` updates existing specs on duplicate title match instead of rejecting
- Site knowledge prompt injection capped at 15 most relevant specs, sorted by useCount + recency
- System prompt: enforce DOM queries over screenshots for content questions, require evidence-based answers, verify DOM changes after modifications
- System prompt: added stable selector strategy (`[data-testid]`, `[aria-label]`, `[role]`) and style injection guidance
- `save_site_spec` excluded from 3-tool-call limit
- Sonnet and Opus marked as beta in model selectors

### Fixed
- Confirmation modal go-back handler reuses `resetSwitchModeUI()` instead of duplicating logic
- Modal code cleaned up: extracted helpers, cached DOM refs, eliminated duplication

## [1.2.0] - 2026-01-28

### Added
- Context compression system — auto-summarizes old messages at 25k token threshold
- Anti-slop prompt rules to prevent apologetic looping behavior

### Fixed
- Screenshot button error (`pendingImage` reference)
- HTML conversion button stuck on "Converting..." with no error handling
- Scroll position lost when switching between tabs

### Changed
- System prompt now enforces max 3 tool calls per response
- Tool descriptions updated to prevent unwanted file creation

## [1.0.0] - 2026-01-27

### Added
- Initial release
- Sidebar chat interface with real-time streaming responses from Claude API
- 61 browser automation tools across 17 categories
- Autonomy modes with confirmation modals for high-risk operations
- Site knowledge system for per-domain learning
- Iteration limits with interactive continue/stop prompts
- Conversation export to markdown
- Model selection (Haiku 3.5, Haiku 4.5, Sonnet, Opus)
- Token usage tracking with cache efficiency display
- User-driven selection mode for marking page elements

[Unreleased]: https://github.com/DrBenedictPorkins/foxhole-claude/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/DrBenedictPorkins/foxhole-claude/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/DrBenedictPorkins/foxhole-claude/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/DrBenedictPorkins/foxhole-claude/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/DrBenedictPorkins/foxhole-claude/releases/tag/v1.0.0
