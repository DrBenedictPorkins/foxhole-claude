# Foxhole for Claude

Skip Puppeteer/Playwright. Claude sits in your Firefox sidebar with 62 tools.

Tell it what you want in plain text, it drives the browser.
DOM, network, storage, cookies, scripts — your logged-in session, not a headless bot.

## Install

```
git clone https://github.com/DrBenedictPorkins/foxhole-claude.git
```

1. Firefox → `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json`
2. Sidebar icon → Settings → Anthropic API key

## Tools

| Category | Tools |
|----------|-------|
| Tabs | `list_tabs` `get_active_tab` `switch_tab` `create_tab` `close_tab` |
| Navigation | `navigate` `reload_page` `go_back` `go_forward` `get_current_url` `get_page_title` |
| DOM | `dom_stats` `get_page_content` `get_dom_structure` `query_selector` `get_element_properties` `get_computed_styles` `get_element_bounds` `list_frames` |
| Interaction | `click_element` `type_text` `fill_form` `scroll_to` `hover_element` `focus_element` `press_key` `select_option` `set_checkbox` |
| Vision | `take_screenshot` `take_element_screenshot` `read_image` |
| Output | `create_markdown` `create_html` `open_download` |
| Cookies | `get_cookies` `set_cookie` `delete_cookie` |
| Storage | `get_local_storage` `get_session_storage` `set_storage_item` `clear_storage` |
| Script | `execute_script` |
| Wait | `wait_for_element` `wait_for_navigation` `wait` |
| Network | `get_network_requests` `clear_network_requests` `get_network_request_detail` `set_request_headers` `block_urls` |
| Clipboard | `read_clipboard` `write_clipboard` |
| Buffers | `query_buffer` `clear_buffer` |
| Knowledge | `save_site_spec` |
| Fetch | `fetch_url` |
| Marking | `mark_elements` `get_marked_elements` `clear_marked_elements` |
| Selection | `toggle_selection_mode` `get_user_selections` `clear_user_selections` |

Two autonomy modes: confirm risky actions (default) or full auto.

## Architecture

Manifest V2 WebExtension. Raw JS/CSS/HTML — no bundler.

| Layer | Path | Role |
|-------|------|------|
| Background | `background/` | API calls, tool routing, site knowledge |
| Content Script | `content/` | Page context execution |
| Sidebar | `sidebar/` | Chat UI, modals, tab state |
| Options | `options/` | Settings |

## Privacy

All data stays local. Only external call is Anthropic's API with your key.

## License

MIT
