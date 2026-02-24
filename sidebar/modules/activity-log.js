/**
 * Activity Log module for the sidebar chat interface.
 * Manages the collapsible activity log that shows tool calls and their results.
 *
 * Exported via window.ActivityLog for MV2 compatibility.
 */

// Use window.RenderUtils.escapeHtml (loaded before this script)

// ========== Configuration ==========

/**
 * List of tools considered high-risk.
 * These require confirmation in default mode ("Confirm risky actions").
 */
const DEFAULT_HIGH_RISK_TOOLS = [
  'click_element',
  'type_text',
  'navigate',
  'execute_script',
  'fill_form',
  'submit_form'
];

// ========== Helper Functions ==========

/**
 * Checks if a tool is considered high-risk.
 *
 * @param {string} toolName - The name of the tool to check
 * @param {string[]} [highRiskList] - Custom list of high-risk tools, defaults to DEFAULT_HIGH_RISK_TOOLS
 * @returns {boolean} True if the tool is high-risk
 */
function isHighRiskTool(toolName, highRiskList = DEFAULT_HIGH_RISK_TOOLS) {
  return highRiskList.includes(toolName);
}

/**
 * Creates the SVG icon for the activity header.
 *
 * @returns {string} SVG HTML string
 */
function createActivityIcon() {
  return `<svg class="activity-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
  </svg>`;
}

/**
 * Creates the toggle chevron SVG.
 *
 * @returns {string} SVG HTML string
 */
function createToggleIcon() {
  return `<svg class="activity-toggle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="6,9 12,15 18,9"/>
  </svg>`;
}

/**
 * Creates the high-risk badge HTML.
 *
 * @returns {string} HTML string for the badge
 */
function createHighRiskBadge() {
  return `<span class="high-risk-badge" title="High-risk: requires confirmation in default mode">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  </span>`;
}

/**
 * Creates the success checkmark SVG.
 *
 * @returns {string} SVG HTML string
 */
function createSuccessIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="20,6 9,17 4,12"/>
  </svg>`;
}

/**
 * Creates the error X icon SVG.
 *
 * @returns {string} SVG HTML string
 */
function createErrorIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
  </svg>`;
}

// ========== Result Formatting ==========

/**
 * Formats a tool result for display.
 * Handles different result types and truncates long content.
 *
 * @param {*} result - The tool result (string, object, or other)
 * @param {number} [maxLength=2000] - Maximum length before truncation
 * @returns {string} Formatted result string
 */
function formatResult(result, maxLength = 2000) {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  if (resultStr.length > maxLength) {
    return resultStr.substring(0, maxLength) + '\n... (truncated)';
  }

  return resultStr;
}

/**
 * Creates the result content HTML for the activity item details.
 *
 * @param {*} result - The tool result
 * @param {string} toolName - The name of the tool
 * @returns {string} Formatted result text
 */
function createResultContent(result, _toolName) {
  return formatResult(result);
}

// ========== Download UI ==========

/**
 * Creates a download button container for file results.
 * Used when a tool result includes a downloadable file.
 *
 * @param {Object} result - The tool result containing file info
 * @param {number} result.downloadId - The browser download ID
 * @param {string} [result.filePath] - The local file path
 * @param {string} [result.fileUrl] - The file URL
 * @param {boolean} [result.isMarkdown] - Whether this is a markdown file
 * @param {string} [result.markdownContent] - The markdown content for HTML conversion
 * @param {HTMLElement} insertAfterElement - Element to insert the container after
 * @returns {HTMLElement|null} The created container element or null if already exists
 */
function createDownloadButtons(result, insertAfterElement) {
  if (!result || !result.needsUserClick || !result.downloadId) {
    return null;
  }

  // Check if container already exists
  const parent = insertAfterElement.parentElement;
  if (!parent) return null;

  const existingContainer = parent.querySelector(
    `.open-download-container[data-download-id="${result.downloadId}"]`
  );
  if (existingContainer) {
    return null;
  }

  // Create container for buttons and path
  const container = document.createElement('div');
  container.className = 'open-download-container';
  container.dataset.downloadId = result.downloadId;
  container.style.cssText = 'margin: 12px 0; padding: 12px; background: #2a2a2a; border-radius: 8px; border: 1px solid #444;';

  // Button row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;';

  // Open button
  const openBtn = createOpenButton(result.downloadId);
  btnRow.appendChild(openBtn);

  // Copy URL button
  const copyBtn = createCopyUrlButton(result.fileUrl, result.filePath);
  btnRow.appendChild(copyBtn);

  // Add "View as HTML" button for markdown files
  if (result.isMarkdown && result.markdownContent) {
    const htmlBtn = createViewAsHtmlButton(result.markdownContent, result.filename);
    btnRow.appendChild(htmlBtn);
  }

  container.appendChild(btnRow);

  // File path display
  if (result.filePath) {
    const pathDiv = document.createElement('div');
    pathDiv.style.cssText = 'font-size: 11px; color: #888; word-break: break-all; font-family: monospace;';
    pathDiv.textContent = result.filePath;
    container.appendChild(pathDiv);
  }

  // Insert after the specified element
  insertAfterElement.after(container);

  return container;
}

/**
 * Creates the "Open" button for downloaded files.
 *
 * @param {number} downloadId - The browser download ID
 * @returns {HTMLButtonElement} The open button element
 */
function createOpenButton(downloadId) {
  const openBtn = document.createElement('button');
  openBtn.innerHTML = 'Open';
  openBtn.className = 'open-file-btn';
  openBtn.dataset.downloadId = String(downloadId);
  openBtn.dataset.label = 'Open';
  openBtn.style.cssText = 'flex: 1; padding: 10px 16px; background: #C4A052; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;';

  openBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      openBtn.textContent = 'Opening...';
      openBtn.disabled = true;
      await browser.downloads.open(downloadId);
      openBtn.textContent = '✓ Opened';
      // Re-enable after brief feedback
      setTimeout(() => {
        openBtn.innerHTML = 'Open';
        openBtn.disabled = false;
      }, 1500);
    } catch (err) {
      console.error('downloads.open failed:', err);
      try {
        await browser.downloads.show(downloadId);
        openBtn.textContent = '✓ In Finder';
        setTimeout(() => {
          openBtn.innerHTML = 'Open';
          openBtn.disabled = false;
        }, 1500);
      } catch (err2) {
        openBtn.textContent = '✗ Failed';
        openBtn.style.background = '#f87171';
        setTimeout(() => {
          openBtn.innerHTML = 'Open';
          openBtn.style.background = '#C4A052';
          openBtn.disabled = false;
        }, 2000);
      }
    }
  });

  return openBtn;
}

/**
 * Creates the "Copy URL" button for downloaded files.
 *
 * @param {string} [fileUrl] - The file URL
 * @param {string} [filePath] - The local file path
 * @returns {HTMLButtonElement} The copy button element
 */
function createCopyUrlButton(fileUrl, filePath) {
  const copyBtn = document.createElement('button');
  copyBtn.innerHTML = 'Copy URL';
  copyBtn.className = 'copy-url-btn';
  copyBtn.dataset.fileUrl = fileUrl || '';
  copyBtn.dataset.filePath = filePath || '';
  copyBtn.style.cssText = 'padding: 10px 16px; background: #555; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;';

  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = fileUrl || `file://${filePath}`;
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = '✓ Copied!';
      copyBtn.style.background = '#666';
      setTimeout(() => {
        copyBtn.innerHTML = 'Copy URL';
        copyBtn.style.background = '#555';
      }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  });

  return copyBtn;
}

/**
 * Creates the "View as HTML" button for markdown files.
 * Converts markdown to HTML and opens in a new tab.
 *
 * @param {string} markdownContent - The markdown content to convert
 * @param {string} [filename] - Original filename for the title
 * @returns {HTMLButtonElement} The HTML view button element
 */
function createViewAsHtmlButton(markdownContent, filename) {
  const htmlBtn = document.createElement('button');
  htmlBtn.innerHTML = 'View as HTML';
  htmlBtn.className = 'view-html-btn';
  htmlBtn.style.cssText = 'padding: 10px 16px; background: #4a7c59; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;';
  htmlBtn.dataset.markdownContent = markdownContent;
  htmlBtn.dataset.filename = filename || '';

  htmlBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      htmlBtn.textContent = 'Opening...';
      htmlBtn.disabled = true;

      let htmlContent;
      try {
        if (typeof marked !== 'undefined' && marked.parse) {
          htmlContent = marked.parse(markdownContent);
        } else {
          htmlContent = markdownContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        }
      } catch (parseErr) {
        console.error('Markdown parse error:', parseErr);
        htmlContent = markdownContent
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
      }

      const title = filename ? filename.replace(/\.md$/i, '') : 'Claude Report';
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:900px;margin:0 auto;padding:40px 20px;background:#1a1a1a;color:#e0e0e0;line-height:1.6}h1,h2,h3,h4{color:#fff;margin-top:1.5em}h1{border-bottom:2px solid #444;padding-bottom:.5em}h2{border-bottom:1px solid #333;padding-bottom:.3em}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #444;padding:12px;text-align:left}th{background:#333;color:#fff}tr:nth-child(even){background:#252525}code{background:#333;padding:2px 6px;border-radius:3px;font-family:'SF Mono',Monaco,monospace}pre{background:#2d2d2d;padding:16px;border-radius:8px;overflow-x:auto;border:1px solid #444}pre code{background:none;padding:0}a{color:#6db3f2}blockquote{border-left:4px solid #444;margin:1em 0;padding-left:1em;color:#aaa}ul,ol{padding-left:2em}li{margin:.5em 0}hr{border:none;border-top:1px solid #444;margin:2em 0}</style></head><body>${htmlContent}</body></html>`;

      const key = 'htmlViewer_' + Date.now();
      await browser.storage.local.set({ [key]: fullHtml });
      const viewerUrl = browser.runtime.getURL('viewer/viewer.html') + '#' + key;
      await browser.tabs.create({ url: viewerUrl });

      htmlBtn.textContent = '✓ Opened';
      setTimeout(() => {
        htmlBtn.innerHTML = 'View as HTML';
        htmlBtn.disabled = false;
      }, 1500);
    } catch (err) {
      console.error('View as HTML failed:', err);
      htmlBtn.textContent = '✗ Failed';
      htmlBtn.style.background = '#f87171';
      htmlBtn.disabled = false;
      setTimeout(() => {
        htmlBtn.innerHTML = 'View as HTML';
        htmlBtn.style.background = '#4a7c59';
      }, 2000);
    }
  });

  return htmlBtn;
}

// ========== Core Activity Log Functions ==========

/**
 * Gets or creates the activity log container for the current assistant message.
 *
 * @param {HTMLElement} chatContainer - The chat container element
 * @returns {HTMLElement|null} The activity log element or null if no assistant message exists
 */
function getOrCreate(chatContainer) {
  const msgElement = chatContainer.querySelector('.message.assistant:last-child');
  if (!msgElement) return null;

  const contentElement = msgElement.querySelector('.message-content');
  let activityLog = contentElement.querySelector('.activity-log');

  if (!activityLog) {
    activityLog = document.createElement('div');
    activityLog.className = 'activity-log collapsed';

    const header = document.createElement('div');
    header.className = 'activity-header';
    header.innerHTML = `
      <span class="activity-summary">
        ${createActivityIcon()}
        <span class="activity-count">0 actions</span>
      </span>
      ${createToggleIcon()}
    `;

    header.addEventListener('click', () => {
      activityLog.classList.toggle('collapsed');
    });

    const items = document.createElement('div');
    items.className = 'activity-items';

    activityLog.appendChild(header);
    activityLog.appendChild(items);
    contentElement.appendChild(activityLog);
  }

  return activityLog;
}

/**
 * Adds a tool call entry to the activity log.
 *
 * @param {HTMLElement} chatContainer - The chat container element
 * @param {string} toolName - The name of the tool being called
 * @param {Object} toolInput - The input parameters for the tool
 * @param {string} toolId - Unique identifier for this tool call
 * @param {string[]} [highRiskTools] - List of high-risk tool names
 * @returns {HTMLElement|null} The created tool item element or null if activity log not found
 */
function addTool(chatContainer, toolName, toolInput, toolId, highRiskTools) {
  const activityLog = getOrCreate(chatContainer);
  if (!activityLog) return null;

  const items = activityLog.querySelector('.activity-items');
  const toolItem = document.createElement('div');
  toolItem.className = 'activity-item pending';
  toolItem.dataset.toolId = toolId;
  toolItem.dataset.toolName = toolName;

  // Check if this is a high-risk tool
  const highRisk = isHighRiskTool(toolName, highRiskTools);
  const highRiskBadgeHtml = highRisk ? createHighRiskBadge() : '';

  toolItem.innerHTML = `
    <span class="activity-item-status">
      <span class="activity-spinner"></span>
    </span>
    <span class="activity-item-name">${window.RenderUtils.escapeHtml(toolName)}${highRiskBadgeHtml}</span>
    <span class="activity-item-toggle">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6,9 12,15 18,9"/>
      </svg>
    </span>
  `;

  const details = document.createElement('div');
  details.className = 'activity-item-details';
  details.innerHTML = `
    <div class="activity-detail-section">
      <div class="activity-detail-label">Input:</div>
      <pre class="activity-detail-content">${window.RenderUtils.escapeHtml(JSON.stringify(toolInput, null, 2))}</pre>
    </div>
    <div class="activity-detail-section result-section" style="display:none;">
      <div class="activity-detail-label">Result:</div>
      <pre class="activity-detail-content result-content"></pre>
    </div>
  `;

  toolItem.addEventListener('click', (e) => {
    if (e.target.closest('.activity-item-details')) return;
    toolItem.classList.toggle('expanded');
  });

  toolItem.appendChild(details);
  items.appendChild(toolItem);

  // Update count
  updateCount(activityLog);

  return toolItem;
}

/**
 * Updates the result display for a completed tool call.
 * Core logic for updating status icons and result content.
 *
 * @param {HTMLElement} toolItem - The tool item element
 * @param {*} result - The tool result
 * @param {boolean} isError - Whether the result is an error
 */
function updateResultDisplay(toolItem, result, isError) {
  // Update status
  toolItem.classList.remove('pending');
  toolItem.classList.add(isError ? 'error' : 'success');

  const statusSpan = toolItem.querySelector('.activity-item-status');
  if (isError) {
    statusSpan.innerHTML = createErrorIcon();
    // Auto-expand errors
    toolItem.classList.add('expanded');
  } else {
    statusSpan.innerHTML = createSuccessIcon();
  }

  // Update result content
  const resultSection = toolItem.querySelector('.result-section');
  const resultContent = toolItem.querySelector('.result-content');
  if (resultSection && resultContent) {
    resultSection.style.display = 'block';
    resultContent.textContent = formatResult(result);
  }
}

/**
 * Updates a tool result in the activity log.
 * Handles status updates, result display, and download button creation.
 *
 * @param {HTMLElement} chatContainer - The chat container element
 * @param {string} toolId - The tool call ID
 * @param {*} result - The tool result
 * @param {boolean} isError - Whether the result is an error
 * @param {Object} [callbacks] - Optional callbacks for side effects
 * @param {Function} [callbacks.onSiteSpecSaved] - Called when save_site_spec succeeds
 */
function updateResult(chatContainer, toolId, result, isError, callbacks = {}) {
  const toolItem = chatContainer.querySelector(`.activity-item[data-tool-id="${toolId}"]`);
  if (!toolItem) return;

  // Update the display (status icon and result content)
  updateResultDisplay(toolItem, result, isError);

  // Handle save_site_spec success
  if (!isError) {
    const toolName = toolItem.dataset.toolName;
    if (toolName === 'save_site_spec' && callbacks.onSiteSpecSaved) {
      try {
        const resultObj = typeof result === 'string' ? JSON.parse(result) : result;
        if (resultObj?.success) {
          callbacks.onSiteSpecSaved();
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  // Add download buttons at message level for file results
  if (result && result.needsUserClick && result.downloadId) {
    const msgElement = chatContainer.querySelector('.message.assistant:last-child');
    const contentElement = msgElement?.querySelector('.message-content');
    if (contentElement) {
      const activityLog = contentElement.querySelector('.activity-log');
      const insertAfter = activityLog || contentElement.lastElementChild;
      if (insertAfter) {
        const container = createDownloadButtons(result, insertAfter);
        if (container) {
          console.log('[ActivityLog] Added Open container for download:', result.downloadId);
        }
      }
    }
  }

  // Update the count to reflect new status
  const activityLog = toolItem.closest('.activity-log');
  if (activityLog) {
    updateCount(activityLog);
  }
}

/**
 * Updates the activity count badge in the activity log header.
 *
 * @param {HTMLElement} activityLog - The activity log element
 */
function updateCount(activityLog) {
  if (!activityLog) return;

  const items = activityLog.querySelectorAll('.activity-item');
  const pending = activityLog.querySelectorAll('.activity-item.pending').length;
  const errors = activityLog.querySelectorAll('.activity-item.error').length;
  const countSpan = activityLog.querySelector('.activity-count');

  if (!countSpan) return;

  let text = `${items.length} action${items.length !== 1 ? 's' : ''}`;
  if (pending > 0) text += ` (${pending} running)`;
  if (errors > 0) text += ` (${errors} failed)`;

  countSpan.textContent = text;

  // Show/hide errors indicator
  if (errors > 0) {
    activityLog.classList.add('has-errors');
  } else {
    activityLog.classList.remove('has-errors');
  }
}

/**
 * Legacy function for compatibility - creates a tool call element.
 * Returns a hidden placeholder since the activity log handles display.
 *
 * @param {HTMLElement} chatContainer - The chat container element
 * @param {string} toolName - The name of the tool
 * @param {Object} toolInput - The tool input parameters
 * @param {string} toolId - The tool call ID
 * @param {string[]} [highRiskTools] - List of high-risk tool names
 * @returns {HTMLElement} A hidden placeholder element
 */
function createToolCallElement(chatContainer, toolName, toolInput, toolId, highRiskTools) {
  addTool(chatContainer, toolName, toolInput, toolId, highRiskTools);
  const placeholder = document.createElement('span');
  placeholder.style.display = 'none';
  return placeholder;
}

// ========== Module Export ==========

/**
 * Activity Log API exposed for MV2 compatibility.
 */
window.ActivityLog = {
  getOrCreate,
  addTool,
  updateResult,
  updateCount,
  createToolCallElement,
  // Helper functions
  formatResult,
  createDownloadButtons,
  createViewAsHtmlButton,
  isHighRiskTool,
  // Internal helpers exposed for testing/extensibility
  updateResultDisplay,
  createResultContent
};

