# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-01-28

### Added
- Context compression system - auto-summarizes old messages at 25k token threshold
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
- Initial release of Claude Browser Assistant extension
- Sidebar chat interface with real-time streaming responses from Claude API
- 61 browser automation tools across 17 categories (DOM manipulation, navigation, screenshots, cookies, localStorage, network inspection, and more)
- Autonomy modes: "Ask before acting" (confirmation modal) and "Act without asking" (auto-execute)
- Site knowledge system for per-domain learning and issue tracking
- Iteration limits to prevent runaway tool call loops
- Conversation export to markdown format
- Model selection dropdown (Claude Sonnet 4, Haiku 3.5, Haiku 4.5)
- Token usage tracking with cache efficiency display in toolbar
- High-risk tool detection for operation confirmation
- User-driven selection mode for marking page elements
- Dark theme UI with red header, gold accents, and risk warning banner

[1.2.0]: https://github.com/DrBenedictPorkins/foxhole-claude/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/DrBenedictPorkins/foxhole-claude/releases/tag/v1.0.0
