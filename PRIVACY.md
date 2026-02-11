# Privacy Policy

**Foxhole for Claude** - Firefox Browser Extension

Last updated: February 10, 2026

---

## Overview

Foxhole for Claude is a browser extension that enables you to interact with web pages through natural language conversation with Claude, Anthropic's AI assistant. This document explains how the extension handles your data.

**Key Points:**
- All data is stored locally on your device
- The extension only communicates with Anthropic's API
- No telemetry, analytics, or third-party data collection
- No data is sold or shared

---

## Data Storage

### Local Storage Only

All extension data is stored locally using Firefox's `browser.storage.local` API, which provides encryption at rest. This includes:

- Your Anthropic API key
- Conversation history
- Extension settings and preferences
- Site-specific knowledge and shortcuts

**Your data never leaves your device except when sent to Anthropic's API as part of your conversations.**

### Data Retention

- Conversation history persists until you clear it
- You can delete all stored data at any time through the extension settings
- Uninstalling the extension removes all associated data

---

## External Communication

### Anthropic API

The extension communicates exclusively with Anthropic's API (`api.anthropic.com`) to process your conversations with Claude. Data sent to Anthropic includes:

- Your conversation messages
- Tool requests and responses (e.g., page content you ask Claude to analyze)
- Screenshots and images when you use visual analysis tools (`take_screenshot`, `take_element_screenshot`, `read_image`) — sent as base64-encoded image blocks
- Your API key for authentication

Anthropic's data handling is governed by their [Privacy Policy](https://www.anthropic.com/privacy) and [Terms of Service](https://www.anthropic.com/terms).

### No Other External Communication

The extension does not:
- Send data to any other servers
- Include analytics or telemetry
- Track your browsing activity
- Share data with third parties

---

## Browser Permissions

The extension requires the following permissions to function. Each permission is used only when necessary and only in response to your explicit requests through the chat interface.

| Permission | Purpose |
|------------|---------|
| `tabs` | List and switch between open browser tabs |
| `activeTab` | Access the current tab for DOM operations (reading page content, clicking elements) |
| `webRequest` | Monitor network requests for debugging purposes when requested |
| `webRequestBlocking` | Block specific URLs when you request this functionality |
| `<all_urls>` | Execute content scripts on any webpage you choose to interact with |
| `storage` | Store your API key, conversation history, and settings locally |
| `cookies` | Read or modify cookies when you explicitly request it |
| `clipboardRead` | Read clipboard content when you ask Claude to access it |
| `clipboardWrite` | Copy content to your clipboard when requested |
| `notifications` | Display browser notifications for task completion or alerts |
| `webNavigation` | Track page navigation events for proper tool execution |
| `history` | Access browsing history only when you explicitly request it |
| `downloads` | Save files to your Downloads folder when requested |
| `downloads.open` | Open downloaded files when you request it |
| `sessions` | Access recently closed tabs when requested |
| `bookmarks` | Read or modify bookmarks only when you explicitly request it |

### Permission Philosophy

- Permissions are requested upfront for technical necessity but are only **used** when you initiate an action
- The extension never performs actions without your knowledge
- Sensitive operations (navigation, form submission, etc.) can be configured to require explicit confirmation

---

## Security

### API Key Protection

- Your Anthropic API key is stored in Firefox's encrypted local storage
- The key is only transmitted to Anthropic's API over HTTPS
- The key is never logged, transmitted elsewhere, or accessible to other extensions

### Content Script Isolation

- Content scripts run in an isolated context
- Page scripts cannot access extension data
- The extension cannot access data from pages you haven't interacted with

---

## Your Rights

You have full control over your data:

- **Access**: View all stored data through the extension settings
- **Delete**: Clear conversation history, site knowledge, or all data at any time
- **Export**: Export your data before deletion if desired
- **Revoke**: Remove the extension to delete all associated data

---

## Changes to This Policy

Any changes to this privacy policy will be reflected in this document with an updated "Last updated" date. Significant changes will be noted in the extension's release notes.

---

## Contact

For privacy-related questions or concerns about this extension, please open an issue on the project's repository.

---

## Summary

Foxhole for Claude is designed with privacy as a priority:

1. **Local-first**: Your data stays on your device
2. **Minimal communication**: Only talks to Anthropic's API
3. **No tracking**: Zero telemetry or analytics
4. **User control**: You decide what actions the extension takes
5. **Transparent**: All permissions are documented and justified
