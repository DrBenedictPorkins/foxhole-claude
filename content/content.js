/**
 * Foxhole for Claude - Content Script
 * Handles DOM manipulation commands from background script
 * Adapted from FoxHole Debug Bridge content.js
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__claude_assistant_injected) {
    return;
  }
  window.__claude_assistant_injected = true;

  // Settings - default to capturing source
  let captureLogSource = true;

  // Load setting from storage
  browser.storage.local.get('captureLogSource').then(result => {
    captureLogSource = result.captureLogSource !== false;
    // Update the page script setting
    window.postMessage({ type: '__claude_assistant_setting', captureLogSource }, '*');
  }).catch(() => {
    // Ignore errors, use default
  });

  // Listen for console logs from page context
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === '__claude_assistant_console') {
      try {
        browser.runtime.sendMessage({
          type: 'console_log',
          data: event.data.data
        }).catch(() => {});
      } catch (e) {
        // Ignore
      }
    }
  });

  // Inject console hook into page context
  const pageScript = `
(function() {
  if (window.__claude_assistant_page_injected) return;
  window.__claude_assistant_page_injected = true;

  let captureLogSource = true;

  // Listen for setting updates from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === '__claude_assistant_setting' && 'captureLogSource' in event.data) {
      captureLogSource = event.data.captureLogSource;
    }
  });

  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  function interceptConsole(level) {
    console[level] = function(...args) {
      originalConsole[level].apply(console, args);

      let source = null;
      if (captureLogSource) {
        try {
          const stack = new Error().stack;
          if (stack) {
            const lines = stack.split('\\n');
            for (let i = 2; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              // Skip our injected script
              if (line.includes('__claude_assistant')) continue;

              let match = line.match(/@(.+):(\\d+):(\\d+)$/);
              if (!match) match = line.match(/\\((.+):(\\d+):(\\d+)\\)$/);
              if (!match) match = line.match(/at (.+):(\\d+):(\\d+)$/);

              if (match) {
                source = { file: match[1], line: parseInt(match[2], 10), column: parseInt(match[3], 10) };
                break;
              }
            }
          }
        } catch (e) {}
      }

      try {
        window.postMessage({
          type: '__claude_assistant_console',
          data: {
            level,
            args: args.map(arg => {
              try {
                if (arg instanceof Error) {
                  return { type: 'Error', message: arg.message, stack: arg.stack };
                }
                return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
              } catch (e) {
                return String(arg);
              }
            }),
            timestamp: Date.now(),
            location: window.location.href,
            source
          }
        }, '*');
      } catch (e) {}
    };
  }

  ['log', 'warn', 'error', 'info', 'debug'].forEach(interceptConsole);
})();
`;

  // Inject script into page context
  const script = document.createElement('script');
  script.textContent = pageScript;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();

  // Error interception
  window.addEventListener('error', (event) => {
    try {
      browser.runtime.sendMessage({
        type: 'js_error',
        data: {
          message: event.message,
          source: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error ? {
            message: event.error.message,
            stack: event.error.stack
          } : null,
          timestamp: Date.now(),
          location: window.location.href
        }
      }).catch(() => {});
    } catch (e) {
      // Ignore
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    try {
      // Serialize the rejection reason properly
      let reasonMessage;
      let reasonData = null;
      const reason = event.reason;

      if (reason instanceof Error) {
        reasonMessage = reason.message;
      } else if (typeof reason === 'string') {
        reasonMessage = reason;
      } else if (reason && typeof reason === 'object') {
        try {
          reasonMessage = JSON.stringify(reason);
          reasonData = reason;
        } catch (e) {
          reasonMessage = reason.message || reason.toString();
        }
      } else {
        reasonMessage = String(reason);
      }

      browser.runtime.sendMessage({
        type: 'js_error',
        data: {
          message: 'Unhandled Promise Rejection: ' + reasonMessage,
          error: reason ? {
            message: reasonMessage,
            stack: reason?.stack,
            data: reasonData
          } : null,
          timestamp: Date.now(),
          location: window.location.href
        }
      }).catch(() => {});
    } catch (e) {
      // Ignore
    }
  });

  // WebSocket interception (wrapped in try-catch as Firefox marks WebSocket as read-only)
  try {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(...args) {
      const ws = new OriginalWebSocket(...args);
      const url = args[0];

      ws.addEventListener('message', (event) => {
        try {
          browser.runtime.sendMessage({
            type: 'websocket_message',
            data: {
              direction: 'receive',
              url,
              data: event.data,
              timestamp: Date.now(),
              location: window.location.href
            }
          }).catch(() => {});
        } catch (e) {
          // Ignore
        }
      });

      const originalSend = ws.send;
      ws.send = function(data) {
        try {
          browser.runtime.sendMessage({
            type: 'websocket_message',
            data: {
              direction: 'send',
              url,
              data,
              timestamp: Date.now(),
              location: window.location.href
            }
          }).catch(() => {});
        } catch (e) {
          // Ignore
        }
        return originalSend.call(this, data);
      };

      return ws;
    };
  } catch (e) {
    // WebSocket interception not available (Firefox marks it as read-only)
    // Continue without WebSocket monitoring
  }

  // ==========================================================================
  // USER-DRIVEN SELECTION MODE
  // Allows user to click elements to mark them for later retrieval
  // ==========================================================================

  let selectionModeActive = false;
  let hoveredElement = null;

  function enterSelectionMode() {
    if (selectionModeActive) return { alreadyActive: true };

    selectionModeActive = true;
    document.body.style.cursor = 'crosshair';

    // Inject selection mode styles
    const style = document.createElement('style');
    style.id = 'claude-selection-mode-styles';
    style.textContent = `
      .claude-hover-highlight { outline: 2px dashed #007bff !important; outline-offset: 2px; }
      [data-user-selected="true"] { outline: 3px solid #FFD700 !important; outline-offset: 2px; background-color: rgba(255,215,0,0.1) !important; }
    `;
    document.head.appendChild(style);

    document.addEventListener('mouseover', handleSelectionHover);
    document.addEventListener('mouseout', handleSelectionHoverOut);
    document.addEventListener('click', handleSelectionClick, true);
    document.addEventListener('keydown', handleSelectionEscape);

    return { active: true, message: 'Selection mode activated. Click elements to mark them. Press Escape to exit.' };
  }

  function exitSelectionMode() {
    if (!selectionModeActive) return { alreadyInactive: true };

    selectionModeActive = false;
    document.body.style.cursor = '';
    document.getElementById('claude-selection-mode-styles')?.remove();
    document.removeEventListener('mouseover', handleSelectionHover);
    document.removeEventListener('mouseout', handleSelectionHoverOut);
    document.removeEventListener('click', handleSelectionClick, true);
    document.removeEventListener('keydown', handleSelectionEscape);

    if (hoveredElement) {
      hoveredElement.classList.remove('claude-hover-highlight');
      hoveredElement = null;
    }

    // Count what was selected
    const selected = document.querySelectorAll('[data-user-selected="true"]');
    return { active: false, selectedCount: selected.length, message: `Selection mode deactivated. ${selected.length} element(s) selected.` };
  }

  function handleSelectionHover(e) {
    if (!selectionModeActive) return;
    if (hoveredElement) hoveredElement.classList.remove('claude-hover-highlight');
    hoveredElement = e.target;
    hoveredElement.classList.add('claude-hover-highlight');
  }

  function handleSelectionHoverOut(e) {
    if (e.target === hoveredElement) {
      hoveredElement.classList.remove('claude-hover-highlight');
    }
  }

  function handleSelectionClick(e) {
    if (!selectionModeActive) return;
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    // Toggle selection
    if (el.getAttribute('data-user-selected') === 'true') {
      el.removeAttribute('data-user-selected');
    } else {
      el.setAttribute('data-user-selected', 'true');
    }
  }

  function handleSelectionEscape(e) {
    if (e.key === 'Escape' && selectionModeActive) {
      exitSelectionMode();
      // Notify background that selection mode was exited via Escape
      try {
        browser.runtime.sendMessage({
          type: 'selection_mode_exited',
          selectedCount: document.querySelectorAll('[data-user-selected="true"]').length
        }).catch(() => {});
      } catch (err) {
        // Ignore
      }
    }
  }

  function getUserSelections(params = {}) {
    const { include_html = false, include_text = true, include_parent = true } = params;
    const elements = document.querySelectorAll('[data-user-selected="true"]');

    const items = Array.from(elements).map((el, index) => {
      const item = {
        index,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null
      };

      if (include_text) {
        const text = el.textContent?.trim() || '';
        item.text = text.slice(0, 200) + (text.length > 200 ? '...' : '');
      }

      if (include_html) {
        const html = el.outerHTML || '';
        item.html = html.slice(0, 500) + (html.length > 500 ? '...' : '');
      }

      // Include parent container info for partial selections (e.g. price tag within product card)
      if (include_parent) {
        const parent = findMeaningfulParent(el);
        if (parent && parent !== el) {
          const parentText = parent.textContent?.trim() || '';
          item.parent = {
            tag: parent.tagName.toLowerCase(),
            id: parent.id || null,
            className: parent.className || null,
            text: parentText.slice(0, 500) + (parentText.length > 500 ? '...' : '')
          };
          item.parentSelector = buildSelector(parent);
        }
      }

      return item;
    });

    return {
      count: items.length,
      items,
      selectionModeActive
    };
  }

  // Find meaningful parent container based on DOM structure
  // Looks for a parent with significantly more content than the selected element
  function findMeaningfulParent(el) {
    const selectedTextLen = (el.textContent?.trim() || '').length;
    let current = el.parentElement;
    let depth = 0;

    while (current && depth < 8) {
      const tag = current.tagName.toLowerCase();

      // Skip layout containers that are too broad
      if (['body', 'html', 'main', 'header', 'footer', 'nav'].includes(tag)) break;

      const parentTextLen = (current.textContent?.trim() || '').length;
      const hasMoreContent = parentTextLen > selectedTextLen * 1.5 && parentTextLen < 2000;
      const hasMultipleChildren = current.children.length > 1;

      // Good parent: has more content and multiple children (suggests it's a container)
      if (hasMoreContent && hasMultipleChildren) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    // Fallback: immediate parent if it has more content
    if (el.parentElement) {
      const parentTextLen = (el.parentElement.textContent?.trim() || '').length;
      if (parentTextLen > selectedTextLen * 1.2) {
        return el.parentElement;
      }
    }

    return null;
  }

  // Build CSS selector for element
  function buildSelector(el) {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    if (el.className) {
      const mainClass = el.className.split(/\s+/)[0];
      if (mainClass && !mainClass.includes(':')) return `${tag}.${mainClass}`;
    }
    return tag;
  }

  function clearUserSelections() {
    const elements = document.querySelectorAll('[data-user-selected="true"]');
    let cleared = 0;
    elements.forEach(el => {
      el.removeAttribute('data-user-selected');
      cleared++;
    });
    return { cleared };
  }

  // ==========================================================================
  // Command Handlers - Receive commands from background script
  // ==========================================================================

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, params } = message;

    // Skip messages that aren't commands for us
    if (!action) {
      return false;
    }

    // Handle command asynchronously
    handleCommand(action, params || {})
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));

    return true; // Keep channel open for async response
  });

  /**
   * Get cleaned page content with hidden/injected elements stripped.
   * Clones the DOM to avoid mutating the live page.
   */
  function getCleanedPageContent() {
    const clone = document.documentElement.cloneNode(true);

    // Remove script, style, noscript, stylesheet links
    clone.querySelectorAll('script, style, noscript, link[rel="stylesheet"]').forEach(el => el.remove());

    // Remove meta tags with content attribute (can carry hidden instructions)
    clone.querySelectorAll('meta[content]').forEach(el => el.remove());

    // Remove aria-hidden elements
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());

    // Remove elements hidden via inline styles
    clone.querySelectorAll('*').forEach(el => {
      const style = el.getAttribute('style');
      if (style) {
        const lower = style.toLowerCase();
        if (
          lower.includes('display:none') || lower.includes('display: none') ||
          lower.includes('visibility:hidden') || lower.includes('visibility: hidden') ||
          /opacity\s*:\s*0(?:[;\s]|$)/.test(lower)
        ) {
          el.remove();
        }
      }
    });

    // Remove HTML comment nodes (recursive walk)
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT, null, false);
    const comments = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }
    comments.forEach(c => c.parentNode && c.parentNode.removeChild(c));

    return clone.outerHTML;
  }

  async function handleCommand(action, params) {
    switch (action) {
      case 'ping':
        return { pong: true, frameId: getFrameId() };

      case 'get_dom':
      case 'get_page_content':
        return { html: getCleanedPageContent() };

      case 'get_page_text':
        return { text: document.body.innerText };

      case 'query_selector':
        return handleQuerySelector(params);

      case 'get_computed_styles':
        return handleGetComputedStyles(params);

      case 'get_element_properties':
        return handleGetElementProperties(params);

      case 'execute_script':
        return handleExecuteScript(params);

      case 'click_element':
        return handleClickElement(params);

      case 'type_text':
        return handleTypeText(params);

      case 'press_key':
        return handlePressKey(params);

      case 'scroll':
      case 'scroll_to':
        return handleScroll(params);

      case 'scroll_to_element':
        return handleScrollToElement(params);

      case 'hover_element':
        return handleHoverElement(params);

      case 'focus_element':
        return handleFocusElement(params);

      case 'select_option':
        return handleSelectOption(params);

      case 'set_checkbox':
        return handleSetCheckbox(params);

      case 'get_storage':
      case 'get_local_storage':
        return handleGetStorage({ type: 'local', ...params });

      case 'get_session_storage':
        return handleGetStorage({ type: 'session', ...params });

      case 'set_storage':
      case 'set_local_storage':
        return handleSetStorage({ type: 'local', ...params });

      case 'clear_storage':
        return handleClearStorage(params);

      case 'get_element_bounds':
        return handleGetElementBounds(params);

      case 'dom_stats':
        return handleDomStats(params);

      case 'get_dom_structure':
        return handleGetDomStructure(params);

      case 'wait_for_element':
        return handleWaitForElement(params);

      case 'fill_form':
        return handleFillForm(params);

      case 'list_frames':
        return handleListFrames(params);

      case 'update_setting':
        if ('captureLogSource' in params) {
          captureLogSource = params.captureLogSource;
          // Also update the page script
          window.postMessage({ type: '__claude_assistant_setting', captureLogSource: params.captureLogSource }, '*');
        }
        return { success: true };

      // User-driven selection mode
      case 'toggle_selection_mode':
        if (params.enable) {
          return enterSelectionMode();
        } else {
          return exitSelectionMode();
        }

      case 'get_user_selections':
        return getUserSelections(params);

      case 'clear_user_selections':
        return clearUserSelections();

      // Clean text (remove excessive blank lines)
      case 'clean_text':
        return handleCleanText(params);

      // IndexedDB and Cache Storage
      case 'list_indexeddb':
        return await handleListIndexedDB(params);
      case 'clear_indexeddb':
        return await handleClearIndexedDB(params);
      case 'list_cache_storage':
        return await handleListCacheStorage(params);
      case 'clear_cache_storage':
        return await handleClearCacheStorage(params);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function getFrameId() {
    // Return frame identification for iframe support
    if (window === window.top) {
      return 0; // Main frame
    }
    // For iframes, try to identify by name or index
    try {
      return window.name || 'iframe';
    } catch (e) {
      return 'iframe';
    }
  }

  function findElement(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    return element;
  }

  // ==========================================================================
  // DOM Query Handlers
  // ==========================================================================

  function handleQuerySelector(params) {
    const { selector, all } = params;

    if (all) {
      const elements = Array.from(document.querySelectorAll(selector));
      return {
        elements: elements.map((el, index) => ({
          index,
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          textContent: el.textContent?.substring(0, 100)
        }))
      };
    } else {
      const element = document.querySelector(selector);
      if (!element) {
        return { found: false };
      }
      return {
        found: true,
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        textContent: element.textContent?.substring(0, 200),
        innerHTML: element.innerHTML?.substring(0, 500)
      };
    }
  }

  function handleGetComputedStyles(params) {
    const { selector } = params;
    const element = findElement(selector);
    const styles = window.getComputedStyle(element);

    const styleObject = {};
    for (let prop of styles) {
      styleObject[prop] = styles.getPropertyValue(prop);
    }

    return { styles: styleObject };
  }

  function handleGetElementProperties(params) {
    const { selector, properties } = params;
    const element = findElement(selector);

    const result = {
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      textContent: element.textContent?.substring(0, 200),
    };

    // If specific properties requested, get those too
    if (properties && Array.isArray(properties)) {
      for (const prop of properties) {
        if (prop in element) {
          const value = element[prop];
          // Handle different value types
          if (typeof value === 'function') {
            continue; // Skip methods
          } else if (value instanceof Element) {
            result[prop] = { tagName: value.tagName, id: value.id };
          } else if (typeof value === 'object' && value !== null) {
            try {
              result[prop] = JSON.stringify(value);
            } catch (e) {
              result[prop] = String(value);
            }
          } else {
            result[prop] = value;
          }
        }
      }
    }

    return { properties: result };
  }

  function handleGetElementBounds(params) {
    const { selector } = params;
    const element = findElement(selector);
    const rect = element.getBoundingClientRect();

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    };
  }

  // ==========================================================================
  // DOM Stats and Structure (from handlers.ts inline scripts)
  // ==========================================================================

  function handleDomStats(params) {
    const includeTags = params.includeTags || false;

    const all = document.querySelectorAll('*');
    let maxDepth = 0;
    const byTag = includeTags ? {} : null;

    all.forEach(el => {
      if (byTag) {
        byTag[el.tagName] = (byTag[el.tagName] || 0) + 1;
      }
      let depth = 0, node = el;
      while (node.parentElement) {
        depth++;
        node = node.parentElement;
      }
      if (depth > maxDepth) maxDepth = depth;
    });

    const result = {
      totalElements: all.length,
      maxDepth: maxDepth,
      htmlSize: document.documentElement.outerHTML.length,
      iframeCount: document.querySelectorAll('iframe').length,
      formCount: document.querySelectorAll('form').length,
      linkCount: document.querySelectorAll('a').length,
      imageCount: document.querySelectorAll('img').length
    };

    if (includeTags && byTag) {
      const sorted = Object.entries(byTag)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
      result.topTags = Object.fromEntries(sorted);
    }

    return result;
  }

  function handleGetDomStructure(params) {
    const selector = params.selector || 'body';
    const maxDepth = params.depth ?? 2;

    // Detect raw content (JSON/text/XML viewed directly in browser)
    const body = document.body;
    if (selector === 'body' && body.children.length === 1 && body.children[0].tagName === 'PRE') {
      const content = body.textContent || '';
      const size = content.length;
      let contentType = 'text';

      // Detect JSON
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          JSON.parse(trimmed);
          contentType = 'json';
        } catch {}
      }
      // Detect XML
      else if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.includes('</'))) {
        contentType = 'xml';
      }

      return {
        raw_content: true,
        contentType: contentType,
        size: size,
        preview: content.slice(0, 500) + (size > 500 ? '...' : ''),
        hint: 'Use get_page_content for full payload'
      };
    }

    // Attributes to include in output
    const showAttrs = ['id', 'class', 'role', 'data-testid', 'type', 'name', 'href', 'src'];

    function getAttrsString(el) {
      let attrs = '';
      for (const attr of showAttrs) {
        let val = el.getAttribute(attr);
        if (val) {
          // Truncate long class lists
          if (attr === 'class' && val.length > 60) {
            val = val.slice(0, 57) + '...';
          }
          // Truncate long hrefs/srcs
          if ((attr === 'href' || attr === 'src') && val.length > 80) {
            val = val.slice(0, 77) + '...';
          }
          attrs += ' ' + attr + '="' + val.replace(/"/g, '&quot;') + '"';
        }
      }
      return attrs;
    }

    function summarize(node, depth, indent) {
      // Skip non-element nodes at top level of output
      if (node.nodeType !== 1) return null;

      const el = node;
      const tag = el.tagName.toLowerCase();
      const attrs = getAttrsString(el);
      const spaces = '  '.repeat(indent);

      // Count direct element children
      const elementChildren = Array.from(el.children);
      const childCount = elementChildren.length;

      // Get direct text content (not from descendants)
      let directText = '';
      for (const child of el.childNodes) {
        if (child.nodeType === 3) { // TEXT_NODE
          directText += child.textContent;
        }
      }
      directText = directText.trim();

      // Void elements (self-closing)
      const voidTags = ['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr'];
      if (voidTags.includes(tag)) {
        return spaces + '<' + tag + attrs + '/>';
      }

      // At max depth - summarize children
      if (depth >= maxDepth) {
        if (childCount > 0) {
          return spaces + '<' + tag + attrs + '><!-- ' + childCount + ' children --></' + tag + '>';
        } else if (directText.length > 0) {
          const preview = directText.length > 60 ? directText.slice(0, 57) + '...' : directText;
          return spaces + '<' + tag + attrs + '>' + preview + '</' + tag + '>';
        } else {
          return spaces + '<' + tag + attrs + '></' + tag + '>';
        }
      }

      // Recurse into children
      const childResults = [];
      for (const child of elementChildren) {
        const result = summarize(child, depth + 1, indent + 1);
        if (result) childResults.push(result);
      }

      // Build output
      if (childResults.length === 0) {
        // No element children - show text if any
        if (directText.length > 0) {
          const preview = directText.length > 60 ? directText.slice(0, 57) + '...' : directText;
          return spaces + '<' + tag + attrs + '>' + preview + '</' + tag + '>';
        }
        return spaces + '<' + tag + attrs + '></' + tag + '>';
      }

      return spaces + '<' + tag + attrs + '>\n' + childResults.join('\n') + '\n' + spaces + '</' + tag + '>';
    }

    const root = document.querySelector(selector);
    if (!root) {
      return { error: 'Selector not found', selector: selector };
    }

    return {
      structure: summarize(root, 0, 0),
      selector: selector,
      depth: maxDepth
    };
  }

  // ==========================================================================
  // Script Execution
  // ==========================================================================

  async function handleExecuteScript(params) {
    const { script, code, preview, force } = params;
    const scriptCode = script || code; // Support both 'script' and 'code' parameter names
    const PAYLOAD_LIMIT = 50000; // 50KB threshold

    if (!scriptCode) {
      return { error: 'No script/code provided' };
    }

    let result;
    try {
      result = eval(scriptCode);
      // Handle promises returned from evaluated scripts
      if (result && typeof result.then === 'function') {
        result = await result;
      }
    } catch (evalError) {
      return {
        error: 'Script execution failed',
        message: evalError.message,
        name: evalError.name
      };
    }

    // Check payload size
    let serialized;
    try {
      serialized = JSON.stringify(result);
    } catch (e) {
      serialized = String(result);
    }

    const payloadSize = serialized.length;

    // If payload exceeds limit and not forced/preview
    if (payloadSize > PAYLOAD_LIMIT && !preview && !force) {
      return {
        error: 'payload_too_large',
        size: payloadSize,
        sizeFormatted: (payloadSize / 1024).toFixed(1) + 'KB',
        limit: PAYLOAD_LIMIT,
        limitFormatted: (PAYLOAD_LIMIT / 1024).toFixed(0) + 'KB',
        message: `Result exceeds ${(PAYLOAD_LIMIT / 1024).toFixed(0)}KB (actual: ${(payloadSize / 1024).toFixed(1)}KB). Options: 1) Rewrite JS to filter/limit results, 2) Use preview:true for first ${(PAYLOAD_LIMIT / 1024).toFixed(0)}KB sample, 3) Use force:true to get full payload.`
      };
    }

    // Preview mode - return truncated sample
    if (preview && payloadSize > PAYLOAD_LIMIT) {
      return {
        preview: true,
        sample: serialized.slice(0, PAYLOAD_LIMIT),
        truncatedAt: PAYLOAD_LIMIT,
        totalSize: payloadSize,
        totalSizeFormatted: (payloadSize / 1024).toFixed(1) + 'KB',
        message: `Showing first ${(PAYLOAD_LIMIT / 1024).toFixed(0)}KB of ${(payloadSize / 1024).toFixed(1)}KB. Use force:true for full payload or rewrite JS for targeted extraction.`
      };
    }

    return { result };
  }

  // ==========================================================================
  // Element Interaction Handlers
  // ==========================================================================

  function handleClickElement(params) {
    const { selector } = params;
    const element = findElement(selector);
    element.click();
    return { success: true, clicked: true, selector };
  }

  function handleTypeText(params) {
    const { selector, text, append } = params;
    const element = findElement(selector);

    element.focus();

    // REPLACE by default, only append if explicitly requested
    if (append) {
      element.value += text;
    } else {
      element.value = text;
    }

    // Trigger input events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, typed: true, selector, replaced: !append };
  }

  function handlePressKey(params) {
    const { selector, key, ctrlKey, shiftKey, altKey, metaKey } = params;
    const element = selector ? findElement(selector) : document.activeElement;

    const eventOptions = {
      key,
      code: key,
      ctrlKey: ctrlKey || false,
      shiftKey: shiftKey || false,
      altKey: altKey || false,
      metaKey: metaKey || false,
      bubbles: true,
      cancelable: true
    };

    element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    element.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
    element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));

    return { success: true };
  }

  function handleScroll(params) {
    const { x, y, selector } = params;

    // If selector provided, scroll to element
    if (selector) {
      return handleScrollToElement({ selector, behavior: params.behavior });
    }

    window.scrollTo(x || 0, y || 0);
    return { success: true, scrolled: true };
  }

  function handleScrollToElement(params) {
    const { selector, behavior } = params;
    const element = findElement(selector);
    element.scrollIntoView({ behavior: behavior || 'smooth', block: 'center' });
    return { success: true, scrolled: true, selector };
  }

  function handleHoverElement(params) {
    const { selector } = params;
    const element = findElement(selector);

    const rect = element.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseenter', eventOptions));

    return { success: true };
  }

  function handleFocusElement(params) {
    const { selector } = params;
    const element = findElement(selector);
    element.focus();
    return { success: true };
  }

  function handleSelectOption(params) {
    const { selector, value, index, text } = params;
    const element = findElement(selector);

    if (element.tagName !== 'SELECT') {
      throw new Error('Element is not a SELECT element');
    }

    let selectedOption = null;

    if (value !== undefined) {
      element.value = value;
      selectedOption = { by: 'value', value };
    } else if (text !== undefined) {
      // Find option by visible text
      const options = Array.from(element.options);
      const option = options.find(opt => opt.textContent.trim() === text);
      if (!option) {
        throw new Error(`Option with text "${text}" not found`);
      }
      element.value = option.value;
      selectedOption = { by: 'text', text, value: option.value };
    } else if (index !== undefined) {
      element.selectedIndex = index;
      selectedOption = { by: 'index', index };
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, selected: selectedOption };
  }

  function handleSetCheckbox(params) {
    const { selector, checked } = params;
    const element = findElement(selector);

    if (element.type !== 'checkbox' && element.type !== 'radio') {
      throw new Error('Element is not a checkbox or radio button');
    }

    element.checked = checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  function handleFillForm(params) {
    const { fields } = params;

    if (!fields || typeof fields !== 'object') {
      throw new Error('fields parameter required');
    }

    const results = [];
    for (const [selector, value] of Object.entries(fields)) {
      try {
        const element = findElement(selector);
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ selector, success: true });
      } catch (e) {
        results.push({ selector, success: false, error: e.message });
      }
    }

    return { success: true, filled: true, fieldCount: Object.keys(fields).length, results };
  }

  // ==========================================================================
  // Clean Text Handler
  // ==========================================================================

  /**
   * Set value on a textarea/input using the native prototype setter.
   * This bypasses React/Vue/Angular property overrides so the framework
   * sees the change and syncs it to state (and ultimately to the server).
   */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  /**
   * Fire the full sequence of events that frameworks and autosave handlers
   * listen for: InputEvent (with inputType for modern handlers), then
   * change, then blur+focus to trigger on-blur save hooks without
   * actually losing focus visually.
   */
  function fireChangeEvents(el) {
    // InputEvent with inputType — React 17+, modern frameworks
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste' // closest semantic for bulk text replacement
    }));
    // change — classic HTML forms, jQuery, Angular.js
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // blur+focus cycle — triggers onBlur autosave (Notion, Confluence, etc.)
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.dispatchEvent(new Event('focus', { bubbles: true }));
  }

  function handleCleanText() {
    const el = document.activeElement;
    if (!el) {
      return { success: false, error: 'No focused element' };
    }

    // Handle <textarea> and <input> elements
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const hasSelection = start !== end;

      let original, cleaned, newValue;
      if (hasSelection) {
        original = el.value.substring(start, end);
        cleaned = original.replace(/\n{3,}/g, '\n\n');
        newValue = el.value.substring(0, start) + cleaned + el.value.substring(end);
      } else {
        original = el.value;
        cleaned = original.replace(/\n{3,}/g, '\n\n');
        newValue = cleaned;
      }

      if (original === cleaned) {
        return { success: true, cleaned: false, linesRemoved: 0 };
      }

      // Use native setter so React/Vue detect the change
      setNativeValue(el, newValue);

      // Restore cursor / selection
      if (hasSelection) {
        el.selectionStart = start;
        el.selectionEnd = start + cleaned.length;
      }

      fireChangeEvents(el);

      const linesRemoved = original.length - cleaned.length;
      return { success: true, cleaned: true, linesRemoved };
    }

    // Handle contentEditable elements (Gmail, Notion, Confluence, etc.)
    if (el.isContentEditable) {
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().length > 0;

      if (hasSelection) {
        const selectedText = selection.toString();
        const cleaned = selectedText.replace(/\n{3,}/g, '\n\n');
        if (selectedText === cleaned) {
          return { success: true, cleaned: false, linesRemoved: 0 };
        }
        // Use execCommand so the edit enters the undo stack and
        // rich-text editors (Draft.js, ProseMirror, Tiptap) pick it up
        document.execCommand('insertText', false, cleaned);
        fireChangeEvents(el);
        const linesRemoved = selectedText.length - cleaned.length;
        return { success: true, cleaned: true, linesRemoved };
      }

      // No selection — select all content, then replace
      const original = el.innerText;
      const cleaned = original.replace(/\n{3,}/g, '\n\n');
      if (original === cleaned) {
        return { success: true, cleaned: false, linesRemoved: 0 };
      }

      // Select all content in the editable, then replace via execCommand
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, cleaned);
      fireChangeEvents(el);

      const linesRemoved = original.length - cleaned.length;
      return { success: true, cleaned: true, linesRemoved };
    }

    return { success: false, error: 'Focused element is not a text input or contentEditable' };
  }

  // ==========================================================================
  // IndexedDB Handlers
  // ==========================================================================

  async function handleListIndexedDB() {
    try {
      // indexedDB.databases() is available in Firefox 126+
      if (typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        return {
          databases: dbs.map(db => ({ name: db.name, version: db.version }))
        };
      }
      // Fallback: can't enumerate without databases() API
      return {
        databases: [],
        note: 'indexedDB.databases() not available in this Firefox version (requires 126+). Use execute_script to probe specific database names.'
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  async function handleClearIndexedDB(params) {
    const { name } = params;
    const deleted = [];

    try {
      if (name) {
        // Delete a specific database
        await new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(new Error(`Failed to delete database: ${name}`));
          req.onblocked = () => resolve(); // Still counts as deleted
        });
        deleted.push(name);
      } else {
        // Delete all databases
        if (typeof indexedDB.databases !== 'function') {
          return { error: 'indexedDB.databases() not available. Provide a specific database name to delete.' };
        }
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          try {
            await new Promise((resolve, reject) => {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(new Error(`Failed to delete: ${db.name}`));
              req.onblocked = () => resolve();
            });
            deleted.push(db.name);
          } catch (e) {
            // Continue deleting others even if one fails
            console.warn(`[ClearIndexedDB] Failed to delete ${db.name}:`, e);
          }
        }
      }
      return { deleted };
    } catch (e) {
      return { error: e.message, deleted };
    }
  }

  // ==========================================================================
  // Cache Storage Handlers
  // ==========================================================================

  async function handleListCacheStorage() {
    try {
      if (!('caches' in window)) {
        return { caches: [], note: 'Cache Storage API not available on this page' };
      }
      const names = await caches.keys();
      return { caches: names };
    } catch (e) {
      return { error: e.message };
    }
  }

  async function handleClearCacheStorage(params) {
    const { name } = params;
    const deleted = [];

    try {
      if (!('caches' in window)) {
        return { error: 'Cache Storage API not available on this page' };
      }

      if (name) {
        const result = await caches.delete(name);
        if (result) deleted.push(name);
        else return { error: `Cache "${name}" not found` };
      } else {
        const names = await caches.keys();
        for (const cacheName of names) {
          const result = await caches.delete(cacheName);
          if (result) deleted.push(cacheName);
        }
      }
      return { deleted };
    } catch (e) {
      return { error: e.message, deleted };
    }
  }

  // ==========================================================================
  // Storage Handlers
  // ==========================================================================

  function handleGetStorage(params) {
    const { type } = params;
    const storage = type === 'session' ? sessionStorage : localStorage;

    const data = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      data[key] = storage.getItem(key);
    }

    return { data };
  }

  function handleSetStorage(params) {
    const { type, key, value } = params;
    const storage = type === 'session' ? sessionStorage : localStorage;
    storage.setItem(key, value);
    return { success: true };
  }

  function handleClearStorage(params) {
    const { type = 'both' } = params;
    if (type === 'both') {
      localStorage.clear();
      sessionStorage.clear();
    } else if (type === 'session') {
      sessionStorage.clear();
    } else {
      localStorage.clear();
    }
    return { success: true, cleared: type };
  }

  // ==========================================================================
  // Wait Handlers
  // ==========================================================================

  function handleWaitForElement(params) {
    const { selector, timeout = 5000 } = params;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        const el = document.querySelector(selector);
        if (el) {
          resolve({
            found: true,
            selector,
            tagName: el.tagName,
            id: el.id,
            className: el.className
          });
        } else if (Date.now() - startTime > timeout) {
          reject(new Error('Timeout waiting for element: ' + selector));
        } else {
          setTimeout(check, 100);
        }
      };

      check();
    });
  }

  function handleListFrames() {
    const frames = [];

    // Add main frame
    frames.push({
      frameId: 0,
      url: window.location.href,
      name: window.name || '(top)',
      isTop: true
    });

    // Find all iframes
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe, index) => {
      let url = 'about:blank';
      try {
        url = iframe.src || iframe.contentWindow?.location?.href || 'about:blank';
      } catch (e) {
        // Cross-origin iframe - can't access location
        url = iframe.src || '(cross-origin)';
      }

      frames.push({
        frameId: index + 1,
        url,
        name: iframe.name || iframe.id || `iframe-${index}`,
        isTop: false,
        selector: iframe.id ? `#${iframe.id}` : (iframe.name ? `iframe[name="${iframe.name}"]` : `iframe:nth-of-type(${index + 1})`)
      });
    });

    return { frames, count: frames.length };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  // Notify background script that content script is ready
  browser.runtime.sendMessage({ type: 'content_script_ready' }).catch(() => {
    // Ignore errors if background script isn't ready yet
  });

  console.log('[Claude Assistant] Content script initialized');
})();
