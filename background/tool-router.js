/**
 * Foxhole for Claude - Tool Router
 * Routes tool calls to appropriate handlers: content script or browser APIs
 * Adapted from FoxHole Debug Bridge background.js and handlers.ts
 */

// ==========================================================================
// Network Request Capture (using webRequest API)
// ==========================================================================

// Network request buffer configuration
const NETWORK_CONFIG = {
  maxRequests: 100,
  maxRequestBodySize: 50000,
  maxResponseBodySize: 50000
};

// Captured network requests (per tab)
const networkRequestBuffers = new Map(); // tabId -> NetworkRequest[]

// Pending requests (being processed)
const pendingRequests = new Map(); // requestId -> NetworkRequest

// Response body chunks for filtering
const responseBodyChunks = new Map(); // requestId -> Uint8Array[]

// Console log buffer (per tab)
const consoleBuffers = new Map(); // tabId -> ConsoleEntry[]

// Error buffer (per tab)
const errorBuffers = new Map(); // tabId -> ErrorEntry[]

// WebSocket message buffer (per tab)
const websocketBuffers = new Map(); // tabId -> WebSocketMessage[]

// Custom request headers (per tab)
const customRequestHeaders = new Map(); // tabId -> { [headerName]: value }

// Blocked URL patterns (per tab)
const blockedUrlPatterns = new Map(); // tabId -> string[]

/**
 * Create a new network request buffer for a tab
 */
function getOrCreateNetworkBuffer(tabId) {
  if (!networkRequestBuffers.has(tabId)) {
    networkRequestBuffers.set(tabId, []);
  }
  return networkRequestBuffers.get(tabId);
}

/**
 * Add request to buffer with FIFO eviction
 */
function addToNetworkBuffer(tabId, request) {
  const buffer = getOrCreateNetworkBuffer(tabId);
  buffer.push(request);
  while (buffer.length > NETWORK_CONFIG.maxRequests) {
    buffer.shift();
  }
}

/**
 * Serialize request body (ArrayBuffer cannot be JSON stringified)
 */
function serializeRequestBody(requestBody) {
  if (!requestBody) return null;

  try {
    // Handle raw data (e.g., JSON POST bodies)
    if (requestBody.raw && Array.isArray(requestBody.raw)) {
      const decoder = new TextDecoder('utf-8');
      const parts = requestBody.raw.map(part => {
        if (part.bytes instanceof ArrayBuffer) {
          return decoder.decode(part.bytes);
        }
        return '';
      });
      const rawText = parts.join('');

      // Truncate if too large
      if (rawText.length > NETWORK_CONFIG.maxRequestBodySize) {
        return rawText.slice(0, NETWORK_CONFIG.maxRequestBodySize) + '...[truncated]';
      }

      // Try to parse as JSON if it looks like JSON
      if (rawText.startsWith('{') || rawText.startsWith('[')) {
        try {
          return JSON.parse(rawText);
        } catch (e) {
          return rawText;
        }
      }
      return rawText;
    }

    // Handle form data
    if (requestBody.formData) {
      return { formData: requestBody.formData };
    }

    return null;
  } catch (e) {
    console.error('[Claude Assistant] Error serializing request body:', e);
    return null;
  }
}

/**
 * Check if we should capture response body (only XHR/fetch requests)
 */
function shouldCaptureResponseBody(details) {
  return details.type === 'xmlhttprequest';
}

// ==========================================================================
// webRequest Listeners for Network Capture
// ==========================================================================

// Capture request initiation
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { requestId, url, method, tabId, type, timeStamp } = details;

    // Skip requests without a tab (e.g., extension requests)
    if (tabId < 0) return;

    const request = {
      requestId,
      url,
      method,
      tabId,
      type,
      startTime: timeStamp,
      requestBody: serializeRequestBody(details.requestBody)
    };

    pendingRequests.set(requestId, request);

    // Set up response body capture for XHR requests
    if (shouldCaptureResponseBody(details)) {
      try {
        const filter = browser.webRequest.filterResponseData(requestId);
        const chunks = [];

        filter.ondata = (event) => {
          chunks.push(new Uint8Array(event.data));
          filter.write(event.data);
        };

        filter.onstop = () => {
          // Combine chunks
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          // Decode as text
          const decoder = new TextDecoder('utf-8');
          let text = decoder.decode(combined);

          // Truncate if too large
          if (text.length > NETWORK_CONFIG.maxResponseBodySize) {
            text = text.slice(0, NETWORK_CONFIG.maxResponseBodySize) + '...[truncated]';
          }

          // Try to parse as JSON
          let responseBody = text;
          if (text.startsWith('{') || text.startsWith('[')) {
            try {
              responseBody = JSON.parse(text);
            } catch (e) {
              // Keep as string
            }
          }

          responseBodyChunks.set(requestId, responseBody);
          filter.disconnect();
        };

        filter.onerror = () => {
          try {
            filter.disconnect();
          } catch (e) {
            // Ignore NS_ERROR_FAILURE - filter may already be disconnected
          }
        };
      } catch (e) {
        // filterResponseData may fail for some request types
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'requestBody']
);

// Capture request headers
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const request = pendingRequests.get(details.requestId);
    if (request) {
      request.requestHeaders = details.requestHeaders;
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

// Capture completed requests
browser.webRequest.onCompleted.addListener(
  (details) => {
    const request = pendingRequests.get(details.requestId);
    if (request) {
      request.statusCode = details.statusCode;
      request.responseHeaders = details.responseHeaders;
      request.endTime = details.timeStamp;
      request.duration = details.timeStamp - request.startTime;

      // Attach captured response body if available
      if (responseBodyChunks.has(details.requestId)) {
        request.responseBody = responseBodyChunks.get(details.requestId);
        responseBodyChunks.delete(details.requestId);
      }

      // Store in buffer
      if (request.tabId >= 0) {
        addToNetworkBuffer(request.tabId, request);
      }

      pendingRequests.delete(details.requestId);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Capture failed requests
browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    const request = pendingRequests.get(details.requestId);
    if (request) {
      request.error = details.error;
      request.endTime = details.timeStamp;
      request.duration = details.timeStamp - request.startTime;

      // Store in buffer even if failed
      if (request.tabId >= 0) {
        addToNetworkBuffer(request.tabId, request);
      }

      pendingRequests.delete(details.requestId);
    }
  },
  { urls: ['<all_urls>'] }
);

// Clean up network buffers when tabs are closed
browser.tabs.onRemoved.addListener((tabId) => {
  networkRequestBuffers.delete(tabId);
});

// ==========================================================================
// Tool Execution Router
// ==========================================================================

/**
 * Execute a tool and return the result
 * @param {string} toolName - Name of the tool to execute
 * @param {object} toolInput - Input parameters for the tool
 * @returns {Promise<object>} - Tool execution result
 */
async function executeTool(toolName, toolInput) {
  try {
    // Get active tab for content script calls
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    const tabId = tab.id;

    // Route to appropriate handler
    switch (toolName) {
      // ========================================
      // Content Script Delegation
      // ========================================

      // DOM interaction
      case 'click_element':
      case 'type_text':
      case 'scroll_to':
      case 'scroll_to_element':
      case 'hover_element':
      case 'focus_element':
      case 'select_option':
      case 'set_checkbox':
      case 'fill_form':
        return await sendToContentScript(tabId, toolName, toolInput);

      case 'press_key':
        // Translate modifiers array to individual boolean flags
        const modifiers = toolInput.modifiers || [];
        return await sendToContentScript(tabId, toolName, {
          key: toolInput.key,
          selector: toolInput.selector,
          ctrlKey: modifiers.includes('ctrl'),
          shiftKey: modifiers.includes('shift'),
          altKey: modifiers.includes('alt'),
          metaKey: modifiers.includes('meta')
        });

      // DOM querying
      case 'query_selector':
      case 'get_element_properties':
      case 'get_computed_styles':
      case 'get_element_bounds':
        return await sendToContentScript(tabId, toolName, toolInput);

      // Page content
      case 'get_page_content':
        return await sendToContentScript(tabId, 'get_dom', toolInput);

      case 'dom_stats':
      case 'get_dom_structure':
        return await sendToContentScript(tabId, toolName, toolInput);

      // Script execution
      case 'execute_script':
        return await sendToContentScript(tabId, toolName, toolInput);

      // Storage
      case 'get_local_storage':
        return await sendToContentScript(tabId, 'get_storage', { type: 'local', ...toolInput });

      case 'get_session_storage':
        return await sendToContentScript(tabId, 'get_storage', { type: 'session', ...toolInput });

      case 'set_storage_item':
        // Translate storageType to type for content script
        return await sendToContentScript(tabId, 'set_storage', {
          type: toolInput.storageType || 'local',
          key: toolInput.key,
          value: toolInput.value
        });

      case 'clear_storage':
        // Translate storageType to type for content script
        return await sendToContentScript(tabId, 'clear_storage', {
          type: toolInput.storageType || 'both'
        });

      // Wait operations
      case 'wait_for_element':
        return await sendToContentScript(tabId, toolName, toolInput);

      // ========================================
      // Browser API Handlers
      // ========================================

      // Navigation
      case 'navigate':
        return await handleNavigate(tabId, toolInput);

      case 'reload_page':
        return await handleReloadPage(tabId, toolInput);

      case 'go_back':
        return await handleGoBack(tabId);

      case 'go_forward':
        return await handleGoForward(tabId);

      // Tab info
      case 'get_current_url':
        return { url: tab.url };

      case 'get_page_title':
        return { title: tab.title };

      // Screenshots
      case 'take_screenshot':
        return await handleTakeScreenshot(toolInput);

      // File Output (Markdown preferred)
      case 'create_markdown':
        return await handleCreateMarkdown(toolInput);

      case 'create_html':
        return await handleCreateHtml(toolInput);

      case 'open_download':
        return await handleOpenDownload(toolInput);

      // Cookies
      case 'get_cookies':
        return await handleGetCookies(tab.url, toolInput);

      case 'set_cookie':
        return await handleSetCookie(tab.url, toolInput);

      case 'delete_cookie':
        return await handleDeleteCookie(tab.url, toolInput);

      // Tab management
      case 'list_tabs':
        return await handleGetTabs();

      case 'switch_tab':
        return await handleSwitchTab(toolInput);

      case 'create_tab':
        return await handleCreateTab(toolInput);

      case 'close_tab':
        return await handleCloseTab(toolInput);

      // Clipboard
      case 'read_clipboard':
        return await handleReadClipboard(tabId);

      case 'write_clipboard':
        return await handleWriteClipboard(tabId, toolInput);

      // Network requests
      case 'get_network_requests':
        return handleGetNetworkRequests(tabId, toolInput);

      case 'clear_network_requests':
        return handleClearNetworkRequests(tabId);

      // Wait for navigation
      case 'wait_for_navigation':
        return await handleWaitForNavigation(tabId, toolInput);

      // Get active tab info
      case 'get_active_tab':
        return { id: tab.id, url: tab.url, title: tab.title, status: tab.status };

      // List frames
      case 'list_frames':
        return await sendToContentScript(tabId, 'list_frames', toolInput);

      // Element screenshot
      case 'take_element_screenshot':
        return await handleTakeElementScreenshot(tabId, toolInput);

      // Simple wait/delay
      case 'wait':
        return await handleWait(toolInput);

      // Network request detail
      case 'get_network_request_detail':
        return handleGetNetworkRequestDetail(tabId, toolInput);

      // Set request headers
      case 'set_request_headers':
        return handleSetRequestHeaders(tabId, toolInput);

      // Block URLs
      case 'block_urls':
        return handleBlockUrls(tabId, toolInput);

      // Query buffer (console, errors, network, websocket)
      case 'query_buffer':
        return handleQueryBuffer(tabId, toolInput);

      // Clear buffer
      case 'clear_buffer':
        return handleClearBuffer(tabId, toolInput);

      // Site Specs
      case 'save_site_spec':
        return await handleSaveSiteSpec(tab, toolInput);

      // External Fetch
      case 'fetch_url':
        return await handleFetchUrl(toolInput);

      // Task History (on-demand context retrieval)
      case 'request_history':
        return handleRequestHistory();

      // Element Marking (highlight & track using data attributes)
      case 'mark_elements':
        return await handleMarkElements(tabId, toolInput);
      case 'get_marked_elements':
        return await handleGetMarkedElements(tabId, toolInput);
      case 'clear_marked_elements':
        return await handleClearMarkedElements(tabId, toolInput);

      // User-Driven Selection Mode (user clicks to mark)
      case 'toggle_selection_mode':
        return await sendToContentScript(tabId, 'toggle_selection_mode', toolInput);
      case 'get_user_selections':
        return await sendToContentScript(tabId, 'get_user_selections', toolInput);
      case 'clear_user_selections':
        return await sendToContentScript(tabId, 'clear_user_selections', toolInput);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return { error: error.message };
  }
}

// ==========================================================================
// Content Script Communication
// ==========================================================================

/**
 * Send a command to the content script
 */
async function sendToContentScript(tabId, action, params) {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      action,
      params
    }, { frameId: 0 }); // Default to top frame

    return response;
  } catch (error) {
    // If content script not ready, try to inject it first
    if (error.message.includes('Receiving end does not exist')) {
      throw new Error('Content script not loaded on this page. The page may need to be refreshed.');
    }
    throw error;
  }
}

// ==========================================================================
// Navigation Handlers
// ==========================================================================

async function handleNavigate(tabId, params) {
  const { url } = params;
  if (!url) {
    throw new Error('URL is required for navigate');
  }
  await browser.tabs.update(tabId, { url });
  return { navigated: true, url };
}

async function handleReloadPage(tabId, params) {
  const bypassCache = params?.bypassCache || false;
  await browser.tabs.reload(tabId, { bypassCache });
  return { reloaded: true };
}

async function handleGoBack(tabId) {
  await browser.tabs.goBack(tabId);
  return { navigated: 'back' };
}

async function handleGoForward(tabId) {
  await browser.tabs.goForward(tabId);
  return { navigated: 'forward' };
}

async function handleWaitForNavigation(tabId, params) {
  const timeout = params?.timeout || 30000;
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkStatus = async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.status === 'complete') {
          resolve({ navigated: true, url: tab.url, title: tab.title });
          return;
        }
      } catch (e) {
        reject(new Error('Tab no longer exists'));
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`Navigation timeout after ${timeout}ms`));
        return;
      }

      setTimeout(checkStatus, 100);
    };

    checkStatus();
  });
}

// ==========================================================================
// Screenshot Handler
// ==========================================================================

async function handleTakeScreenshot(params) {
  const format = params?.format || 'png';
  const quality = params?.quality;
  const saveTo = params?.saveTo;

  const options = { format };
  if (quality && format === 'jpeg') {
    options.quality = quality;
  }

  const dataUrl = await browser.tabs.captureVisibleTab(null, options);

  // If saveTo is provided, save to Downloads folder
  if (saveTo) {
    const blob = await fetch(dataUrl).then(r => r.blob());
    const blobUrl = URL.createObjectURL(blob);

    // Ensure filename has correct extension
    let filename = saveTo;
    const ext = `.${format}`;
    if (!filename.toLowerCase().endsWith(ext)) {
      filename = filename.replace(/\.\w+$/, '') + ext;
    }

    try {
      const downloadId = await browser.downloads.download({
        url: blobUrl,
        filename: filename,
        saveAs: false
      });

      // Wait for download to complete
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Download timeout')), 10000);
        const listener = (delta) => {
          if (delta.id === downloadId && delta.state) {
            if (delta.state.current === 'complete') {
              clearTimeout(timeout);
              browser.downloads.onChanged.removeListener(listener);
              resolve();
            } else if (delta.state.current === 'interrupted') {
              clearTimeout(timeout);
              browser.downloads.onChanged.removeListener(listener);
              reject(new Error('Download interrupted'));
            }
          }
        };
        browser.downloads.onChanged.addListener(listener);
      });

      const [downloadInfo] = await browser.downloads.search({ id: downloadId });
      URL.revokeObjectURL(blobUrl);

      return {
        saved: true,
        filename: filename,
        filePath: downloadInfo?.filename || filename,
        message: `Screenshot saved to Downloads: ${filename}`
      };
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      throw err;
    }
  }

  // Default: return base64 data for viewing
  return { screenshot: dataUrl, format };
}

// ==========================================================================
// File Output Handlers (Markdown preferred, HTML for interactive)
// ==========================================================================

async function handleCreateMarkdown(params) {
  const { content, filename: customFilename } = params;

  if (!content) {
    throw new Error('Markdown content is required');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = customFilename
    ? `${customFilename.replace(/\.md$/i, '')}.md`
    : `claude-output-${timestamp}.md`;

  const blob = new Blob([content], { type: 'text/markdown' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await browser.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: false
    });

    // Wait for download to complete
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Download timeout')), 10000);
      const listener = (delta) => {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            clearTimeout(timeout);
            browser.downloads.onChanged.removeListener(listener);
            resolve();
          } else if (delta.state.current === 'interrupted') {
            clearTimeout(timeout);
            browser.downloads.onChanged.removeListener(listener);
            reject(new Error('Download interrupted'));
          }
        }
      };
      browser.downloads.onChanged.addListener(listener);
    });

    const [downloadInfo] = await browser.downloads.search({ id: downloadId });
    const filePath = downloadInfo?.filename || filename;

    return {
      success: true,
      message: `Markdown saved: ${filename}`,
      downloadId: downloadId,
      filename: filename,
      filePath: filePath,
      needsUserClick: true,
      isMarkdown: true,
      markdownContent: content  // Include content for HTML conversion option
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function handleCreateHtml(params) {
  const { html, title } = params;

  if (!html) {
    throw new Error('HTML content is required');
  }

  // Check if HTML is already a complete document
  const trimmedHtml = html.trim();
  const isCompleteDocument = /^<!doctype\s+html/i.test(trimmedHtml) || /^<html[\s>]/i.test(trimmedHtml);

  let fullHtml;
  if (isCompleteDocument) {
    fullHtml = trimmedHtml;
  } else {
    // Wrap in complete document
    const pageTitle = title || 'Claude Report';
    fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #1a1a1a; color: #e0e0e0; }
h1, h2, h3 { color: #fff; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; }
th, td { border: 1px solid #444; padding: 12px; text-align: left; }
th { background: #333; color: #fff; }
tr:nth-child(even) { background: #252525; }
code { background: #333; padding: 2px 6px; border-radius: 3px; }
pre { background: #333; padding: 16px; border-radius: 8px; overflow-x: auto; }
a { color: #6db3f2; }
</style>
</head>
<body>
${html}
</body>
</html>`;
  }

  const blob = new Blob([fullHtml], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `claude-report-${timestamp}.html`;

  try {
    const downloadId = await browser.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: false
    });

    // Wait for download to complete
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Download timeout')), 10000);
      const listener = (delta) => {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            clearTimeout(timeout);
            browser.downloads.onChanged.removeListener(listener);
            resolve();
          } else if (delta.state.current === 'interrupted') {
            clearTimeout(timeout);
            browser.downloads.onChanged.removeListener(listener);
            reject(new Error('Download interrupted'));
          }
        }
      };
      browser.downloads.onChanged.addListener(listener);
    });

    const [downloadInfo] = await browser.downloads.search({ id: downloadId });
    const filePath = downloadInfo?.filename || filename;
    const fileUrl = `file://${filePath}`;

    return {
      success: true,
      message: `HTML report saved: ${filename}`,
      downloadId: downloadId,
      filename: filename,
      filePath: filePath,
      fileUrl: fileUrl,
      needsUserClick: true
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function handleOpenDownload(params) {
  const { filename } = params;

  if (!filename) {
    throw new Error('Filename is required');
  }

  // Search for downloads matching the filename
  const downloads = await browser.downloads.search({
    query: [filename],
    limit: 10,
    orderBy: ['-startTime']
  });

  if (downloads.length === 0) {
    throw new Error(`No downloads found matching "${filename}"`);
  }

  // Find the most recent complete download
  const download = downloads.find(d => d.state === 'complete');

  if (!download) {
    throw new Error(`No completed downloads found matching "${filename}"`);
  }

  // Open the file
  await browser.downloads.open(download.id);

  return {
    success: true,
    message: `Opened: ${download.filename}`,
    filename: download.filename
  };
}

// ==========================================================================
// Cookie Handlers
// ==========================================================================

async function handleGetCookies(tabUrl, params) {
  const url = params?.url || tabUrl;
  const cookies = await browser.cookies.getAll({ url });
  return { cookies };
}

async function handleSetCookie(tabUrl, params) {
  const { name, value, domain, path, secure, httpOnly, sameSite, expirationDate } = params;

  if (!name || value === undefined) {
    throw new Error('Cookie name and value are required');
  }

  const url = params.url || tabUrl;

  const cookieDetails = {
    url,
    name,
    value
  };

  if (domain) cookieDetails.domain = domain;
  if (path) cookieDetails.path = path;
  if (secure !== undefined) cookieDetails.secure = secure;
  if (httpOnly !== undefined) cookieDetails.httpOnly = httpOnly;
  if (sameSite) cookieDetails.sameSite = sameSite;
  if (expirationDate) cookieDetails.expirationDate = expirationDate;

  await browser.cookies.set(cookieDetails);
  return { set: true, name };
}

async function handleDeleteCookie(tabUrl, params) {
  const { name } = params;
  if (!name) {
    throw new Error('Cookie name is required');
  }

  const url = params.url || tabUrl;
  await browser.cookies.remove({ url, name });
  return { deleted: true, name };
}

// ==========================================================================
// Tab Management Handlers
// ==========================================================================

async function handleGetTabs() {
  const tabs = await browser.tabs.query({});
  return {
    tabs: tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
      status: tab.status
    }))
  };
}

async function handleSwitchTab(params) {
  const { tabId } = params;
  if (!tabId) {
    throw new Error('tabId is required');
  }

  await browser.tabs.update(tabId, { active: true });
  const tab = await browser.tabs.get(tabId);
  await browser.windows.update(tab.windowId, { focused: true });

  return { switched: true, tabId };
}

async function handleCreateTab(params) {
  const { url, active } = params;

  const tab = await browser.tabs.create({
    url: url || 'about:blank',
    active: active !== false // Default to active
  });

  // Notify sidebar if this tab is active so it can show fresh chat
  if (active !== false) {
    browser.runtime.sendMessage({
      type: 'TAB_CREATED_BY_TOOL',
      tabId: tab.id
    }).catch(() => {}); // Sidebar may not be open
  }

  return { created: true, tabId: tab.id, url: tab.url };
}

async function handleCloseTab(params) {
  const { tabId } = params;
  if (!tabId) {
    throw new Error('tabId is required');
  }

  await browser.tabs.remove(tabId);
  return { closed: true, tabId };
}

// ==========================================================================
// Clipboard Handlers
// ==========================================================================

async function handleReadClipboard(tabId) {
  // Use content script to read clipboard (requires user gesture in some cases)
  const result = await sendToContentScript(tabId, 'execute_script', {
    script: `
      (async () => {
        try {
          const text = await navigator.clipboard.readText();
          return { text };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `
  });

  if (result.result) {
    return result.result;
  }
  return result;
}

async function handleWriteClipboard(tabId, params) {
  const { text } = params;
  if (text === undefined) {
    throw new Error('text is required');
  }

  const result = await sendToContentScript(tabId, 'execute_script', {
    script: `
      (async () => {
        try {
          await navigator.clipboard.writeText(${JSON.stringify(text)});
          return { written: true };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `
  });

  if (result.result) {
    return result.result;
  }
  return result;
}

// ==========================================================================
// Network Request Handlers
// ==========================================================================

function handleGetNetworkRequests(tabId, params) {
  const buffer = networkRequestBuffers.get(tabId) || [];
  const limit = params?.limit || 50;
  const filter = params?.filter;

  let requests = [...buffer];

  // Apply filter if provided
  if (filter) {
    const filterLower = filter.toLowerCase();
    requests = requests.filter(req =>
      req.url.toLowerCase().includes(filterLower) ||
      req.method.toLowerCase().includes(filterLower) ||
      (req.type && req.type.toLowerCase().includes(filterLower))
    );
  }

  // Return most recent requests up to limit
  const result = requests.slice(-limit);

  return {
    requests: result,
    total: buffer.length,
    returned: result.length
  };
}

function handleClearNetworkRequests(tabId) {
  networkRequestBuffers.delete(tabId);
  return { cleared: true, tabId };
}

// ==========================================================================
// Element Screenshot Handler
// ==========================================================================

async function handleTakeElementScreenshot(tabId, params) {
  const { selector } = params;
  if (!selector) {
    throw new Error('selector is required');
  }

  // Get element bounds from content script
  const bounds = await sendToContentScript(tabId, 'get_element_bounds', { selector });
  if (bounds.error) {
    throw new Error(bounds.error);
  }

  // Take full viewport screenshot
  const dataUrl = await browser.tabs.captureVisibleTab(null, { format: 'png' });

  // Return with element bounds for client-side cropping
  return {
    screenshot: dataUrl,
    bounds,
    selector,
    note: 'Full viewport captured. Use bounds to crop to element.'
  };
}

// ==========================================================================
// Wait Handler
// ==========================================================================

async function handleWait(params) {
  const { ms } = params;
  if (!ms || ms <= 0) {
    throw new Error('ms must be a positive number');
  }
  if (ms > 30000) {
    throw new Error('Maximum wait time is 30000ms (30 seconds)');
  }

  await new Promise(resolve => setTimeout(resolve, ms));
  return { waited: ms };
}

// ==========================================================================
// Network Request Detail Handler
// ==========================================================================

function handleGetNetworkRequestDetail(tabId, params) {
  const { requestId } = params;
  if (!requestId) {
    throw new Error('requestId is required');
  }

  const buffer = networkRequestBuffers.get(tabId) || [];
  const request = buffer.find(r => r.requestId === requestId);

  if (!request) {
    return { error: 'Request not found', requestId };
  }

  return { request };
}

// ==========================================================================
// Set Request Headers Handler
// ==========================================================================

function handleSetRequestHeaders(tabId, params) {
  const { headers } = params;
  if (!headers || typeof headers !== 'object') {
    throw new Error('headers object is required');
  }

  customRequestHeaders.set(tabId, headers);
  return { set: true, headers: Object.keys(headers) };
}

// ==========================================================================
// Block URLs Handler
// ==========================================================================

function handleBlockUrls(tabId, params) {
  const { patterns } = params;
  if (!patterns || !Array.isArray(patterns)) {
    throw new Error('patterns array is required');
  }

  blockedUrlPatterns.set(tabId, patterns);
  return { blocked: true, patterns };
}

// ==========================================================================
// Query Buffer Handler
// ==========================================================================

function handleQueryBuffer(tabId, params) {
  const { type, transform } = params;
  if (!type) {
    throw new Error('type is required');
  }
  if (!transform) {
    throw new Error('transform is required');
  }

  let buffer;
  switch (type) {
    case 'console':
      buffer = consoleBuffers.get(tabId) || [];
      break;
    case 'errors':
      buffer = errorBuffers.get(tabId) || [];
      break;
    case 'network':
      buffer = networkRequestBuffers.get(tabId) || [];
      break;
    case 'websocket':
      buffer = websocketBuffers.get(tabId) || [];
      break;
    default:
      throw new Error(`Unknown buffer type: ${type}`);
  }

  // Apply JS transform
  try {
    const transformFn = new Function('data', `return data${transform}`);
    const result = transformFn(buffer);
    return { result, type, originalCount: buffer.length };
  } catch (e) {
    return { error: `Transform error: ${e.message}`, transform };
  }
}

// ==========================================================================
// Clear Buffer Handler
// ==========================================================================

function handleClearBuffer(tabId, params) {
  const { dataType = 'all' } = params;

  const cleared = [];

  if (dataType === 'all' || dataType === 'console') {
    consoleBuffers.delete(tabId);
    cleared.push('console');
  }
  if (dataType === 'all' || dataType === 'errors') {
    errorBuffers.delete(tabId);
    cleared.push('errors');
  }
  if (dataType === 'all' || dataType === 'network') {
    networkRequestBuffers.delete(tabId);
    cleared.push('network');
  }
  if (dataType === 'all' || dataType === 'websocket') {
    websocketBuffers.delete(tabId);
    cleared.push('websocket');
  }

  return { cleared, tabId };
}

// ==========================================================================
// Buffer Management Helpers
// ==========================================================================

function addToConsoleBuffer(tabId, entry) {
  if (!consoleBuffers.has(tabId)) {
    consoleBuffers.set(tabId, []);
  }
  const buffer = consoleBuffers.get(tabId);
  buffer.push(entry);
  // Keep last 500 entries
  while (buffer.length > 500) {
    buffer.shift();
  }
}

function addToErrorBuffer(tabId, entry) {
  if (!errorBuffers.has(tabId)) {
    errorBuffers.set(tabId, []);
  }
  const buffer = errorBuffers.get(tabId);
  buffer.push(entry);
  // Keep last 200 entries
  while (buffer.length > 200) {
    buffer.shift();
  }
}

function addToWebsocketBuffer(tabId, entry) {
  if (!websocketBuffers.has(tabId)) {
    websocketBuffers.set(tabId, []);
  }
  const buffer = websocketBuffers.get(tabId);
  buffer.push(entry);
  // Keep last 200 entries
  while (buffer.length > 200) {
    buffer.shift();
  }
}

// ==========================================================================
// Site Specs Handler
// ==========================================================================

async function handleSaveSiteSpec(tab, params) {
  const { type, description, content } = params;

  // Validate required fields
  if (!type || !description || !content) {
    return { success: false, error: 'Missing required fields: type, description, and content are all required' };
  }

  // Validate type
  const validTypes = ['dom', 'api', 'storage', 'shortcut'];
  if (!validTypes.includes(type)) {
    return { success: false, error: `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}` };
  }

  // Get domain from current tab
  let domain;
  try {
    const url = new URL(tab.url);
    domain = url.hostname.replace(/^www\./, '');
  } catch (e) {
    return { success: false, error: 'Could not determine domain from current tab' };
  }

  // Build knowledge item (SiteKnowledge API expects 'title' not 'description')
  const item = {
    type,
    title: description,
    content,
    path: '*'
  };

  // Save via SiteKnowledge (unified API)
  try {
    if (window.SiteKnowledge) {
      const saved = await window.SiteKnowledge.add(domain, item);
      if (saved) {
        console.log(`[SiteKnowledge] Tool saved spec for ${domain}:`, description);
        return {
          success: true,
          message: `Saved Site Spec for ${domain}: "${description}"`,
          spec: saved
        };
      } else {
        return {
          success: false,
          error: 'Spec was duplicate or invalid - a spec with this title already exists'
        };
      }
    } else {
      return { success: false, error: 'SiteKnowledge module not available' };
    }
  } catch (error) {
    console.error('[SiteKnowledge] Tool error:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================================================
// Export for use by background.js
// ==========================================================================
// Fetch URL Handler
// ==========================================================================

async function handleFetchUrl(params) {
  const { url, selector, maxLength = 15000 } = params;

  if (!url) {
    throw new Error('url is required');
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only HTTP/HTTPS URLs are supported');
    }
  } catch (e) {
    throw new Error(`Invalid URL: ${e.message}`);
  }

  console.log(`[FetchUrl] Fetching: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClaudeAssistant/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await response.text();

    // Parse HTML and extract text
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove unwanted elements
    const removeSelectors = [
      'script', 'style', 'noscript', 'iframe', 'svg',
      'nav', 'footer', 'header', 'aside',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '.nav', '.navbar', '.footer', '.header', '.sidebar', '.ad', '.ads', '.advertisement',
      '#nav', '#navbar', '#footer', '#header', '#sidebar'
    ];
    removeSelectors.forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    let content;
    if (selector) {
      // Extract specific element if selector provided
      const targetEl = doc.querySelector(selector);
      if (!targetEl) {
        throw new Error(`Selector "${selector}" not found on page`);
      }
      content = targetEl.textContent || '';
    } else {
      // Get main content area or body
      const main = doc.querySelector('main, article, [role="main"], .main-content, #main, #content, .content');
      content = (main || doc.body)?.textContent || '';
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')           // Collapse whitespace
      .replace(/\n\s*\n/g, '\n\n')    // Normalize paragraph breaks
      .trim();

    // Truncate if needed
    const truncated = content.length > maxLength;
    if (truncated) {
      content = content.substring(0, maxLength) + '\n\n[Content truncated...]';
    }

    console.log(`[FetchUrl] Extracted ${content.length} chars from ${url}`);

    return {
      url: url,
      title: doc.title || null,
      contentLength: content.length,
      truncated,
      content
    };

  } catch (error) {
    console.error(`[FetchUrl] Error:`, error);
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

// ==========================================================================
// Task History
// ==========================================================================

/**
 * Handle request_history tool - returns last 3 task summaries
 * Task history is managed in background.js, accessed via window.getTaskHistory
 */
function handleRequestHistory() {
  if (typeof window.getTaskHistory !== 'function') {
    console.warn('[RequestHistory] getTaskHistory not available');
    return { tasks: [], message: 'No task history available' };
  }

  const history = window.getTaskHistory();

  if (history.length === 0) {
    return { tasks: [], message: 'No previous tasks recorded' };
  }

  // Format for Claude consumption
  const formatted = history.map((task, idx) => ({
    taskNumber: history.length - idx,  // Most recent = highest number
    userRequest: task.userMessage,
    outcome: task.assistantResponse,
    timestamp: new Date(task.timestamp).toISOString()
  }));

  return {
    taskCount: formatted.length,
    tasks: formatted,
    note: 'Most recent task listed first. Use this context to inform your current action.'
  };
}

// ==========================================================================
// ELEMENT MARKING HANDLERS
// ==========================================================================

/**
 * Mark elements matching selector/filter with data attribute and highlight style
 */
async function handleMarkElements(tabId, params) {
  const { selector, filter, label, style } = params;

  if (!selector || !label) {
    return { error: 'selector and label are required' };
  }

  const defaultStyle = 'outline: 3px solid #FFD700; outline-offset: 2px; background-color: rgba(255, 215, 0, 0.1);';
  const highlightStyle = style || defaultStyle;

  // Build the script to run in page context
  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const filterFn = ${filter ? `(el) => { return ${filter}; }` : 'null'};
      const label = ${JSON.stringify(label)};
      const highlightStyle = ${JSON.stringify(highlightStyle)};

      // Inject highlight styles if not already present
      if (!document.getElementById('claude-mark-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'claude-mark-styles';
        styleEl.textContent = '[data-claude-marked] { ' + highlightStyle + ' }';
        document.head.appendChild(styleEl);
      }

      const elements = document.querySelectorAll(selector);
      let marked = 0;

      elements.forEach((el, idx) => {
        let shouldMark = true;
        if (filterFn) {
          try {
            shouldMark = filterFn(el);
          } catch (e) {
            console.warn('[Claude Mark] Filter error on element', idx, e);
            shouldMark = false;
          }
        }

        if (shouldMark) {
          el.setAttribute('data-claude-marked', label);
          el.setAttribute('data-claude-mark-index', marked.toString());
          marked++;
        }
      });

      return { marked, total: elements.length, label };
    })()
  `;

  try {
    const result = await browser.tabs.executeScript(tabId, {
      code: script,
      frameId: 0
    });
    return result[0] || { error: 'No result from script' };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get information about marked elements
 */
async function handleGetMarkedElements(tabId, params) {
  const { label, include_text = true } = params || {};

  const script = `
    (() => {
      const label = ${JSON.stringify(label || null)};
      const includeText = ${include_text};

      const selector = label
        ? '[data-claude-marked="' + label + '"]'
        : '[data-claude-marked]';

      const elements = document.querySelectorAll(selector);

      // Group by label
      const byLabel = {};
      const items = [];

      elements.forEach((el, idx) => {
        const elLabel = el.getAttribute('data-claude-marked');
        if (!byLabel[elLabel]) byLabel[elLabel] = 0;
        byLabel[elLabel]++;

        if (includeText) {
          const text = el.textContent?.trim().slice(0, 100) || '';
          items.push({
            index: idx,
            label: elLabel,
            tag: el.tagName.toLowerCase(),
            text: text + (el.textContent?.length > 100 ? '...' : '')
          });
        }
      });

      return {
        totalMarked: elements.length,
        byLabel,
        items: includeText ? items : undefined
      };
    })()
  `;

  try {
    const result = await browser.tabs.executeScript(tabId, {
      code: script,
      frameId: 0
    });
    return result[0] || { error: 'No result from script' };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Clear marks from elements
 */
async function handleClearMarkedElements(tabId, params) {
  const { label } = params || {};

  const script = `
    (() => {
      const label = ${JSON.stringify(label || null)};

      const selector = label
        ? '[data-claude-marked="' + label + '"]'
        : '[data-claude-marked]';

      const elements = document.querySelectorAll(selector);
      let cleared = 0;

      elements.forEach(el => {
        el.removeAttribute('data-claude-marked');
        el.removeAttribute('data-claude-mark-index');
        cleared++;
      });

      // Remove style element if clearing all
      if (!label) {
        const styleEl = document.getElementById('claude-mark-styles');
        if (styleEl) styleEl.remove();
      }

      return { cleared, label: label || 'all' };
    })()
  `;

  try {
    const result = await browser.tabs.executeScript(tabId, {
      code: script,
      frameId: 0
    });
    return result[0] || { error: 'No result from script' };
  } catch (error) {
    return { error: error.message };
  }
}

// ==========================================================================

// Make executeTool available globally for background.js
window.executeTool = executeTool;

// Export buffer management functions for background.js
window.addToConsoleBuffer = addToConsoleBuffer;
window.addToErrorBuffer = addToErrorBuffer;
window.addToWebsocketBuffer = addToWebsocketBuffer;

// Export network buffer access for debugging
window.getNetworkRequests = (tabId) => networkRequestBuffers.get(tabId) || [];
window.clearAllNetworkRequests = () => networkRequestBuffers.clear();

// Export header/blocking access
window.getCustomRequestHeaders = (tabId) => customRequestHeaders.get(tabId) || {};
window.getBlockedUrlPatterns = (tabId) => blockedUrlPatterns.get(tabId) || [];

console.log('[Claude Assistant] Tool router initialized');
