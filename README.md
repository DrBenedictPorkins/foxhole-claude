# Foxhole for Claude

Chat with Claude to control your Firefox browser. A sidebar extension that connects directly to the Anthropic Claude API, giving Claude access to browser manipulation tools.

## Features

- **Streaming Chat Interface**: Real-time responses from Claude in a convenient sidebar
- **Autonomy Modes**: Choose between "Ask before acting" or "Act without asking" for tool execution
- **Site Knowledge**: Automatically learns and caches site-specific information for better interactions
- **Export Options**: Create markdown or HTML files from extracted content
- **Per-Tab Sessions**: Separate conversation contexts for each browser tab
- **Prompt Caching**: Reduces API costs through intelligent caching of system prompts and site knowledge

## Installation

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file from this directory
4. The Claude sidebar icon will appear in your toolbar
5. Click the icon to open the sidebar, then configure your API key in Settings

## Requirements

- Firefox 91 or higher
- Anthropic API key

## Available Tools

Foxhole for Claude provides 61 browser automation tools organized into the following categories:

| Category | Count | Tools |
|----------|-------|-------|
| Tab Management | 5 | list_tabs, get_active_tab, switch_tab, create_tab, close_tab |
| Navigation | 6 | navigate, reload_page, go_back, go_forward, get_current_url, get_page_title |
| DOM Reading | 8 | dom_stats, get_page_content, get_dom_structure, query_selector, get_element_properties, get_computed_styles, get_element_bounds, list_frames |
| Element Interaction | 9 | click_element, type_text, fill_form, scroll_to, hover_element, focus_element, press_key, select_option, set_checkbox |
| Screenshots | 2 | take_screenshot, take_element_screenshot |
| File Output | 3 | create_markdown, create_html, open_download |
| Cookies | 3 | get_cookies, set_cookie, delete_cookie |
| Storage | 4 | get_local_storage, get_session_storage, set_storage_item, clear_storage |
| Script Execution | 1 | execute_script |
| Waiting | 3 | wait_for_element, wait_for_navigation, wait |
| Network | 5 | get_network_requests, clear_network_requests, get_network_request_detail, set_request_headers, block_urls |
| Clipboard | 2 | read_clipboard, write_clipboard |
| Buffer Query | 2 | query_buffer, clear_buffer |
| Site Specs | 1 | save_site_spec |
| External Fetch | 1 | fetch_url |
| Element Marking | 3 | mark_elements, get_marked_elements, clear_marked_elements |
| User Selection | 3 | toggle_selection_mode, get_user_selections, clear_user_selections |

## Privacy

This extension stores all data locally and only communicates with the Anthropic API. See [PRIVACY.md](PRIVACY.md) for details.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Version

1.0.0
