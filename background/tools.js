/**
 * Foxhole for Claude - Tool Definitions
 *
 * Converted from FoxHole MCP tools to Claude API format.
 * Key difference: MCP uses `inputSchema`, Claude uses `input_schema`
 */

const BROWSER_TOOLS = [
  // ============================================================================
  // TAB MANAGEMENT
  // ============================================================================
  {
    name: 'list_tabs',
    description: 'List all open browser tabs with their URLs and titles',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_active_tab',
    description: 'Get information about the currently active tab',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'switch_tab',
    description: 'Switch to a specific tab by ID',
    input_schema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to switch to',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'create_tab',
    description: 'Create a new browser tab with optional URL',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to open in the new tab',
        },
        active: {
          type: 'boolean',
          description: 'Whether to make the new tab active',
        },
      },
    },
  },
  {
    name: 'close_tab',
    description: 'Close a specific tab',
    input_schema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to close',
        },
      },
      required: ['tabId'],
    },
  },

  // ============================================================================
  // NAVIGATION
  // ============================================================================
  {
    name: 'navigate',
    description: 'Navigate to a URL in the current tab',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'reload_page',
    description: 'Reload the current page',
    input_schema: {
      type: 'object',
      properties: {
        bypassCache: {
          type: 'boolean',
          description: 'Whether to bypass the cache',
        },
      },
    },
  },
  {
    name: 'go_back',
    description: 'Go back in browser history',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'go_forward',
    description: 'Go forward in browser history',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_current_url',
    description: 'Get the URL of the current page',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_page_title',
    description: 'Get the title of the current page',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },

  // ============================================================================
  // DOM READING
  // ============================================================================
  {
    name: 'dom_stats',
    description: 'Get DOM statistics (element count, depth, size) without full HTML. Always call this before get_page_content to check size.',
    input_schema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
        includeTags: {
          type: 'boolean',
          description: 'Include top 15 tag distribution (adds tokens, default false)',
        },
      },
    },
  },
  {
    name: 'get_page_content',
    description: 'Get full page HTML. Can be very large - use dom_stats first to check size.',
    input_schema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
    },
  },
  {
    name: 'get_dom_structure',
    description: 'Get DOM structure at specified depth. Shows element hierarchy with child counts beyond depth limit. Use for exploring large pages without fetching full HTML.',
    input_schema: {
      type: 'object',
      properties: {
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to start from (default: body)',
        },
        depth: {
          type: 'number',
          description: 'How many levels deep to expand (default: 2)',
        },
      },
    },
  },
  {
    name: 'query_selector',
    description: 'Query DOM elements using CSS selector. Returns matching elements with their tag, id, classes, and text content.',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_element_properties',
    description: 'Get properties of a DOM element',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
        properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Properties to retrieve (e.g., ["href", "src", "value"])',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_computed_styles',
    description: 'Get computed CSS styles for an element',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
        styleProperties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific CSS properties to retrieve (e.g., ["color", "font-size"]). If not specified, returns common properties.',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_element_bounds',
    description: 'Get bounding rectangle (position and dimensions) of an element',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'list_frames',
    description: 'List all frames (iframes) with URLs and frameIds.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },

  // ============================================================================
  // ELEMENT INTERACTION
  // ============================================================================
  {
    name: 'click_element',
    description: 'Click on a DOM element',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into an input element. REPLACES existing content by default (clears field first).',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the input element',
        },
        text: {
          type: 'string',
          description: 'Text to type',
        },
        append: {
          type: 'boolean',
          description: 'If true, append to existing text instead of replacing. Default: false (replaces)',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'fill_form',
    description: 'Fill a form with multiple field values at once',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'object',
          description: 'Object mapping CSS selectors to values. E.g., {"#name": "John", "#email": "john@example.com"}',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'scroll_to',
    description: 'Scroll to a specific position or element',
    input_schema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate to scroll to',
        },
        y: {
          type: 'number',
          description: 'Y coordinate to scroll to',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for element to scroll into view (takes precedence over x/y)',
        },
      },
    },
  },
  {
    name: 'hover_element',
    description: 'Hover over a DOM element (trigger mouseenter/mouseover events)',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to hover',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'focus_element',
    description: 'Focus on a DOM element',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to focus',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'press_key',
    description: 'Simulate a key press on the focused element or document',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Key to press (e.g., "Enter", "Tab", "Escape", "a", "ArrowDown")',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys to hold (e.g., ["ctrl", "shift"])',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector - focuses element before key press',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'select_option',
    description: 'Select an option from a <select> dropdown',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the <select> element',
        },
        value: {
          type: 'string',
          description: 'Value of the option to select',
        },
        text: {
          type: 'string',
          description: 'Text content of the option to select (alternative to value)',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'set_checkbox',
    description: 'Check or uncheck a checkbox/radio input',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the checkbox/radio element',
        },
        checked: {
          type: 'boolean',
          description: 'Whether to check (true) or uncheck (false) the element',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector', 'checked'],
    },
  },

  // ============================================================================
  // SCREENSHOTS
  // ============================================================================
  {
    name: 'take_screenshot',
    description: 'Take a screenshot. By default returns base64 for viewing. Use saveTo to save directly to Downloads folder.',
    input_schema: {
      type: 'object',
      properties: {
        saveTo: {
          type: 'string',
          description: 'Filename to save to Downloads (e.g., "page-screenshot.png"). If provided, saves file instead of returning base64.',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Image format (default: png)',
        },
      },
    },
  },
  {
    name: 'take_element_screenshot',
    description: 'Take a screenshot of a specific element',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to capture',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'read_image',
    description: 'Fetch an image from the page and return it for visual analysis. Use this to read text in images, analyze charts, or examine visual content. Accepts a CSS selector for an <img> element OR a direct image URL.',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for an <img> element on the page',
        },
        url: {
          type: 'string',
          description: 'Direct image URL. Use when you have the src but no reliable selector.',
        },
      },
    },
  },

  // ============================================================================
  // FILE OUTPUT - ONLY when user explicitly requests
  // ============================================================================
  {
    name: 'create_markdown',
    description: 'Save markdown file. STOP - only use if user said "save", "export", "report", or "download". Never use to "summarize" or "document" findings - just reply in chat instead.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Markdown content to save',
        },
        filename: {
          type: 'string',
          description: 'Filename without extension (default: "claude-output-{timestamp}")',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'create_html',
    description: 'Save HTML file. STOP - only use if user explicitly said "HTML". Otherwise use create_markdown.',
    input_schema: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'HTML content. Can be body only (auto-wrapped) or complete document.',
        },
        title: {
          type: 'string',
          description: 'Page title (default: "Claude Report")',
        },
      },
      required: ['html'],
    },
  },
  {
    name: 'open_download',
    description: 'Open a previously downloaded file by filename. Searches Downloads folder and opens with default app.',
    input_schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Filename or partial filename to search for (e.g., "claude-report" or "report-2026-01-20")',
        },
      },
      required: ['filename'],
    },
  },

  // ============================================================================
  // COOKIES
  // ============================================================================
  {
    name: 'get_cookies',
    description: 'Get cookies for current page.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to get cookies for (default: current page URL)',
        },
      },
    },
  },
  {
    name: 'set_cookie',
    description: 'Set a cookie',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Cookie name',
        },
        value: {
          type: 'string',
          description: 'Cookie value',
        },
        domain: {
          type: 'string',
          description: 'Cookie domain',
        },
        path: {
          type: 'string',
          description: 'Cookie path (default: /)',
        },
        secure: {
          type: 'boolean',
          description: 'Whether cookie is secure-only',
        },
        httpOnly: {
          type: 'boolean',
          description: 'Whether cookie is HTTP-only',
        },
        expirationDate: {
          type: 'number',
          description: 'Cookie expiration as Unix timestamp',
        },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'delete_cookie',
    description: 'Delete a cookie',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Cookie name to delete',
        },
        url: {
          type: 'string',
          description: 'URL the cookie belongs to (default: current page URL)',
        },
      },
      required: ['name'],
    },
  },

  // ============================================================================
  // STORAGE
  // ============================================================================
  {
    name: 'get_local_storage',
    description: 'Get all localStorage data for the current page.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_session_storage',
    description: 'Get all sessionStorage data for the current page.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_storage_item',
    description: 'Set a localStorage or sessionStorage item',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Storage key',
        },
        value: {
          type: 'string',
          description: 'Storage value',
        },
        storageType: {
          type: 'string',
          enum: ['local', 'session'],
          description: 'Storage type (default: local)',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'clear_storage',
    description: 'Clear localStorage or sessionStorage',
    input_schema: {
      type: 'object',
      properties: {
        storageType: {
          type: 'string',
          enum: ['local', 'session', 'both'],
          description: 'Which storage to clear (default: both)',
        },
      },
    },
  },

  // ============================================================================
  // BROWSING DATA & ADVANCED STORAGE
  // ============================================================================
  {
    name: 'clear_browsing_data',
    description: `Bulk clear browser data via browser.browsingData API.

Clears one or more data types across all domains or for a specific time range.

USE FOR: Clearing browser cache, cookies, history, form data, downloads, service workers, localStorage in bulk.`,
    input_schema: {
      type: 'object',
      properties: {
        dataTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['cache', 'cookies', 'history', 'formData', 'downloads', 'serviceWorkers', 'localStorage'],
          },
          description: 'Data types to clear (e.g., ["cache", "cookies"])',
        },
        since: {
          type: 'number',
          description: 'Only clear data from the last N minutes (e.g., 60 = last hour). Omit to clear all time.',
        },
        originTypes: {
          type: 'string',
          enum: ['unprotectedWeb', 'protectedWeb', 'extension'],
          description: 'Origin type filter (default: unprotectedWeb)',
        },
      },
      required: ['dataTypes'],
    },
  },
  {
    name: 'list_indexeddb',
    description: 'List all IndexedDB databases on the current page. Returns database names and versions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'clear_indexeddb',
    description: 'Delete one or all IndexedDB databases on the current page.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Specific database name to delete. Omit to delete ALL databases.',
        },
      },
    },
  },
  {
    name: 'list_cache_storage',
    description: 'List all Cache Storage caches (Service Worker caches) on the current page.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'clear_cache_storage',
    description: 'Delete one or all Cache Storage caches on the current page.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Specific cache name to delete. Omit to delete ALL caches.',
        },
      },
    },
  },
  {
    name: 'search_history',
    description: 'Search browser history for pages matching a query.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text to match against URLs and titles',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 25)',
        },
        startTime: {
          type: 'string',
          description: 'Start of time range (ISO string or ms since epoch)',
        },
        endTime: {
          type: 'string',
          description: 'End of time range (ISO string or ms since epoch)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'delete_history',
    description: `Delete browser history entries. Can delete a specific URL, a time range, or all history.

Provide exactly ONE of: url, startTime+endTime, or all:true.`,
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Delete history for this specific URL',
        },
        startTime: {
          type: 'string',
          description: 'Start of time range to delete (ISO string or ms since epoch). Requires endTime.',
        },
        endTime: {
          type: 'string',
          description: 'End of time range to delete (ISO string or ms since epoch). Requires startTime.',
        },
        all: {
          type: 'boolean',
          description: 'Set to true to delete ALL history',
        },
      },
    },
  },

  // ============================================================================
  // SCRIPT EXECUTION
  // ============================================================================
  {
    name: 'execute_script',
    description: `Execute JavaScript in page context with full DOM access.

USE FOR: DOM queries, data extraction, element manipulation, reading page state, evaluating expressions.

EXAMPLES:
  // Simple expression
  document.title

  // Extract data
  Array.from(document.querySelectorAll('.item')).map(el => el.textContent)

  // Complex logic (wrap in IIFE)
  (() => { const data = {}; /* logic */; return data; })()

Returns the result of the last expression.`,
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Returns the result of the last expression.',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['code'],
    },
  },

  // ============================================================================
  // WAITING
  // ============================================================================
  {
    name: 'wait_for_element',
    description: 'Wait for an element to appear in the DOM',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 5000)',
        },
        frameId: {
          type: 'number',
          description: 'Frame ID for iframes (default: 0 = top frame)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'wait_for_navigation',
    description: 'Wait for page navigation to complete',
    input_schema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
    },
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration',
    input_schema: {
      type: 'object',
      properties: {
        ms: {
          type: 'number',
          description: 'Milliseconds to wait',
        },
      },
      required: ['ms'],
    },
  },

  // ============================================================================
  // NETWORK
  // ============================================================================
  {
    name: 'get_network_requests',
    description: 'Get captured network requests. Requires network capture to be enabled.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter requests by URL pattern (substring match)',
        },
        type: {
          type: 'string',
          enum: ['xmlhttprequest', 'document', 'script', 'stylesheet', 'image', 'font', 'other'],
          description: 'Filter by request type. "xmlhttprequest" includes both XHR and fetch() calls.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of requests to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'clear_network_requests',
    description: 'Clear captured network requests',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_network_request_detail',
    description: 'Get full details of a network request by ID (headers, bodies).',
    input_schema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'The request ID to fetch',
        },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'set_request_headers',
    description: 'Set custom request headers for subsequent requests',
    input_schema: {
      type: 'object',
      properties: {
        headers: {
          type: 'object',
          description: 'Headers to set (key-value pairs)',
        },
      },
      required: ['headers'],
    },
  },
  {
    name: 'block_urls',
    description: 'Block specific URLs or patterns from loading',
    input_schema: {
      type: 'object',
      properties: {
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'URL patterns to block (supports wildcards)',
        },
      },
      required: ['patterns'],
    },
  },

  // ============================================================================
  // CLIPBOARD
  // ============================================================================
  {
    name: 'read_clipboard',
    description: 'Read text content from clipboard',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'write_clipboard',
    description: 'Write text content to clipboard',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to write to clipboard',
        },
      },
      required: ['text'],
    },
  },

  // ============================================================================
  // BUFFER QUERY (for console, errors, websocket data)
  // ============================================================================
  {
    name: 'query_buffer',
    description: 'Query buffered data (console logs, errors, network, websocket) with JS transform to shape/filter results.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['console', 'errors', 'network', 'websocket'],
          description: 'Buffer type to query',
        },
        transform: {
          type: 'string',
          description: 'Required JS expression applied to data array. Examples: .filter(x => x.level === "error").slice(-20) or .sort((a,b) => b.duration - a.duration).slice(0,5)',
        },
      },
      required: ['type', 'transform'],
    },
  },
  {
    name: 'clear_buffer',
    description: 'Clear data buffers',
    input_schema: {
      type: 'object',
      properties: {
        dataType: {
          type: 'string',
          enum: ['console', 'network', 'websocket', 'errors', 'all'],
          description: 'Specific data type to clear (default: all)',
        },
      },
    },
  },

  // ============================================================================
  // SITE SPECS (persistent knowledge for domains)
  // ============================================================================
  {
    name: 'save_site_spec',
    description: `Save or update a Site Spec for the current domain. Specs persist across sessions and are injected into future conversations on this site.

If a spec with the same description already exists, it will be UPDATED with new content — so always reuse the same description to keep specs current.

SAVE AFTER:
- Discovering stable selectors ([data-testid], [aria-label], [role], IDs, data-attributes)
- Identifying API endpoints from network traffic
- Finding localStorage/sessionStorage keys
- Figuring out a multi-step workflow that works

DON'T SAVE:
- Generic selectors (input, button, a, .btn)
- Hashed class names (.css-1a2b3c, .sc-bdnxRM) — these break between deploys
- One-time information — just tell the user

GOOD: [data-testid="search"], #product-grid [role="listitem"], [aria-label="Add to cart"]
BAD: .css-k008qs, input[type="text"], button.btn-primary

Domain is auto-detected from the current tab.`,
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['profile', 'dom', 'api', 'storage', 'shortcut'],
          description: 'Type of spec: profile (site interaction model — ONE per domain, always read first), dom (CSS selectors), api (endpoints), storage (localStorage/cookies), shortcut (multi-step workflows)',
        },
        description: {
          type: 'string',
          description: 'One-line summary of what this spec documents (e.g., "Product search and filter selectors")',
        },
        content: {
          type: 'string',
          description: 'Technical content - selectors, endpoints, keys, or step sequences. Be specific and actionable.',
        },
      },
      required: ['type', 'description', 'content'],
    },
  },

  {
    name: 'delete_site_spec',
    description: `Delete a site spec that is broken, outdated, or no longer relevant.

USE WHEN:
- A selector no longer matches anything on the page
- An API endpoint returns 404 or has changed
- A workflow no longer works after a site redesign
- A spec is redundant (covered by a newer spec)

Domain is auto-detected from the current tab.`,
    input_schema: {
      type: 'object',
      properties: {
        spec_id: {
          type: 'string',
          description: 'The spec ID shown as "spec_id: ..." in the site knowledge section above the system prompt',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for deletion (e.g., "selector no longer exists after site redesign")',
        },
      },
      required: ['spec_id'],
    },
  },

  // ============================================================================
  // EXTERNAL FETCH (Background fetch without navigation)
  // ============================================================================
  {
    name: 'fetch_url',
    description: `Fetch content from an external URL without navigating away from the current page.

USE FOR:
- Researching products/reviews on other sites while staying on current page
- Fetching documentation or reference material
- Checking external sources without losing current context

LIMITATIONS:
- Returns text content only (no JS execution)
- May not work well on JS-heavy single-page apps
- Large pages will be truncated

Returns extracted text content from the page.`,
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch content from',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to extract specific content (e.g., "article", ".main-content"). If not provided, extracts main body content.',
        },
        maxLength: {
          type: 'number',
          description: 'Maximum characters to return (default: 15000)',
        },
      },
      required: ['url'],
    },
  },

  // ============================================================================
  // ELEMENT MARKING (highlight & track selections using data attributes)
  // ============================================================================
  {
    name: 'mark_elements',
    description: `Mark DOM elements matching criteria with a data attribute for tracking and visual highlighting.

Uses data-claude-marked attribute directly on elements. No event listeners needed.
Marked elements can be queried later with get_marked_elements.

Example: Mark all products under $50
- selector: ".product-card"
- filter: "el => parseFloat(el.querySelector('.price')?.textContent?.replace('$','') || 999) < 50"
- label: "budget-items"`,
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for candidate elements (e.g., ".product-card", "tr.item")'
        },
        filter: {
          type: 'string',
          description: 'Optional JS filter function body. Receives "el" as the element. Return true to mark. (e.g., "el.textContent.includes(\'Sale\')")'
        },
        label: {
          type: 'string',
          description: 'Label for this selection (e.g., "budget-items", "5-star-reviews"). Used to group/identify marks.'
        },
        style: {
          type: 'string',
          description: 'Optional CSS style for highlighting (default: "outline: 3px solid #FFD700; outline-offset: 2px;")'
        }
      },
      required: ['selector', 'label'],
    },
  },
  {
    name: 'get_marked_elements',
    description: `Get information about previously marked elements.

Returns count and summary of elements marked with data-claude-marked attribute.
Can filter by label to get specific selections.`,
    input_schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Optional: filter by specific label. Omit to get all marked elements.'
        },
        include_text: {
          type: 'boolean',
          description: 'Include text content of marked elements (default: true, truncated to 100 chars each)'
        }
      },
    },
  },
  {
    name: 'clear_marked_elements',
    description: `Remove marks from elements. Clears data-claude-marked attribute and highlight styles.`,
    input_schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Optional: clear only elements with this label. Omit to clear ALL marks.'
        }
      },
    },
  },

  // ============================================================================
  // USER-DRIVEN SELECTION MODE
  // Let user click elements to mark them instead of Claude analyzing DOM
  // ============================================================================
  {
    name: 'toggle_selection_mode',
    description: `Enter or exit visual selection mode. In this mode, user can click elements to mark them with a gold highlight.

USE WHEN: User wants to "select", "mark", "highlight", or "pick" things on the page visually.

HOW IT WORKS:
1. Call with enable: true to enter selection mode
2. User sees crosshair cursor, hovers show blue dashed outline
3. User clicks elements to toggle selection (gold highlight)
4. User presses Escape OR you call with enable: false to exit
5. Use get_user_selections to retrieve what they marked

This is much simpler than Claude-driven DOM analysis - user shows exactly what they want.`,
    input_schema: {
      type: 'object',
      properties: {
        enable: {
          type: 'boolean',
          description: 'true to enter selection mode, false to exit'
        }
      },
      required: ['enable']
    },
  },
  {
    name: 'get_user_selections',
    description: `Get all elements the user has marked using selection mode.

Each item includes a "parent" field with the containing element's text - use this when the selection is a small part of a larger unit.`,
    input_schema: {
      type: 'object',
      properties: {
        include_html: {
          type: 'boolean',
          description: 'Include outerHTML snippet (default: false)'
        },
        include_text: {
          type: 'boolean',
          description: 'Include text content (default: true)'
        },
        include_parent: {
          type: 'boolean',
          description: 'Include parent container info (default: true)'
        }
      },
    },
  },
  {
    name: 'clear_user_selections',
    description: `Clear all user selections (remove data-user-selected attribute from all elements).`,
    input_schema: {
      type: 'object',
      properties: {},
    },
  },

];

/**
 * Get a tool definition by name
 * @param {string} name - Tool name
 * @returns {Object|undefined} Tool definition or undefined if not found
 */
function getToolByName(name) {
  return BROWSER_TOOLS.find(tool => tool.name === name);
}

/**
 * Check if a tool is considered high-risk (requires confirmation)
 * @param {string} name - Tool name
 * @returns {boolean} True if high-risk
 */
function isHighRiskTool(name) {
  const highRisk = [
    'click_element',
    'type_text',
    'fill_form',
    'navigate',
    'execute_script',
    'set_cookie',
    'delete_cookie',
    'set_storage_item',
    'clear_storage',
    'write_clipboard',
    'close_tab',
    'press_key',
    'select_option',
    'set_checkbox',
    'clear_browsing_data',
    'clear_indexeddb',
    'clear_cache_storage',
    'delete_history',
  ];
  return highRisk.includes(name);
}

// Export for use in other background scripts
window.BROWSER_TOOLS = BROWSER_TOOLS;
window.getToolByName = getToolByName;
window.isHighRiskTool = isHighRiskTool;
