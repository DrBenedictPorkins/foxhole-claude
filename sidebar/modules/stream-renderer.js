/**
 * Stream rendering module for the sidebar chat interface.
 * Handles streaming responses, message creation, and display formatting.
 *
 * Exported via window.StreamRenderer for MV2 compatibility.
 */

// Use window.RenderUtils and window.Helpers (loaded before this script)
// Note: We alias these locally to avoid verbose window.* calls throughout
// These are wrapped in a function to avoid polluting global scope
const RenderUtils = window.RenderUtils;
const Helpers = window.Helpers;

// ========== Streaming State ==========

/** @type {number|null} Interval ID for batched markdown rendering */
let streamingRenderInterval = null;

/** @type {string} Accumulated raw text during streaming */
let streamingRawText = '';

/** @type {HTMLElement|null} Current text container being streamed to */
let streamingTextContainer = null;

/** @type {string} Last rendered text (to avoid unnecessary re-renders) */
let lastRenderedText = '';

/** @type {boolean} Whether tools were executed since last text (for paragraph breaks) */
let toolsExecutedSinceLastText = false;

// ========== Configuration ==========

/**
 * Tool name to human-readable label mapping.
 * Used to display friendly status messages during streaming.
 */
const TOOL_LABELS = {
  'dom_stats': 'Checking page size',
  'get_page_content': 'Reading page content',
  'get_dom_structure': 'Inspecting DOM structure',
  'query_selector': 'Finding elements',
  'execute_script': 'Running script',
  'click_element': 'Clicking element',
  'type_text': 'Typing text',
  'press_key': 'Pressing key',
  'fill_form': 'Filling form',
  'scroll_to': 'Scrolling',
  'navigate': 'Navigating',
  'reload_page': 'Reloading page',
  'go_back': 'Going back',
  'go_forward': 'Going forward',
  'take_screenshot': 'Taking screenshot',
  'get_cookies': 'Reading cookies',
  'get_local_storage': 'Reading local storage',
  'get_session_storage': 'Reading session storage',
  'wait_for_element': 'Waiting for element',
  'wait_for_navigation': 'Waiting for page load',
  'create_tab': 'Opening new tab',
  'close_tab': 'Closing tab',
  'switch_tab': 'Switching tab',
  'fetch_url': 'Fetching external URL'
};

// ========== Streaming Indicator Functions ==========

/**
 * Creates the streaming indicator HTML element.
 *
 * @returns {HTMLElement} The streaming indicator element
 */
function createStreamingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'streaming-indicator';
  indicator.innerHTML = `
    <span class="streaming-dot"></span>
    <span class="streaming-dot"></span>
    <span class="streaming-dot"></span>
    <span class="streaming-status">Working...</span>
  `;
  return indicator;
}

/**
 * Updates the streaming indicator status text based on accumulated text.
 *
 * @param {HTMLElement} indicator - The streaming indicator element
 * @param {string} rawText - The accumulated raw text
 */
function updateStreamingIndicator(indicator, rawText) {
  const status = indicator.querySelector('.streaming-status');
  if (!status) return;

  // Show last meaningful phrase
  const lastColon = rawText.lastIndexOf(':');
  if (lastColon > 0 && lastColon > rawText.length - 100) {
    const before = rawText.substring(Math.max(0, lastColon - 50), lastColon);
    const lastSentence = before.split(/[.!]/).pop()?.trim() || 'Working';
    status.textContent = lastSentence.substring(0, 40) + (lastSentence.length > 40 ? '...' : '');
  }
}

/**
 * Updates the streaming indicator with tool name.
 *
 * @param {HTMLElement} indicator - The streaming indicator element
 * @param {string} toolName - The name of the tool being used
 */
function updateStreamingIndicatorWithTool(indicator, toolName) {
  const status = indicator.querySelector('.streaming-status');
  if (status) {
    const label = TOOL_LABELS[toolName] || toolName;
    status.textContent = label + '...';
  }
}

/**
 * Renders accumulated streaming text as markdown.
 * Called periodically (every 100ms) during streaming.
 */
function renderStreamingBatch() {
  if (!streamingTextContainer || streamingRawText === lastRenderedText) {
    return; // Nothing new to render
  }

  // Get or create response text div
  let responseDiv = streamingTextContainer.querySelector('.response-text');
  if (!responseDiv) {
    responseDiv = document.createElement('div');
    responseDiv.className = 'response-text';
    streamingTextContainer.appendChild(responseDiv);
  }

  // Strip <answer> tags for streaming display (will be styled properly in finalizeMessage)
  const displayText = streamingRawText.replace(/<\/?answer>/g, '');

  // Render markdown
  responseDiv.innerHTML = RenderUtils.renderMarkdownContent(displayText);
  lastRenderedText = streamingRawText;
}

/**
 * Starts the batched rendering interval for streaming.
 */
function startStreamingInterval() {
  if (streamingRenderInterval) return; // Already running
  streamingRenderInterval = setInterval(renderStreamingBatch, 100);
}

/**
 * Stops the batched rendering interval and cleans up state.
 */
function stopStreamingInterval() {
  if (streamingRenderInterval) {
    clearInterval(streamingRenderInterval);
    streamingRenderInterval = null;
  }
  // Final render to catch any remaining text
  renderStreamingBatch();
  // Reset state
  streamingRawText = '';
  streamingTextContainer = null;
  lastRenderedText = '';
  toolsExecutedSinceLastText = false;
}

/**
 * Appends streaming text to the content element.
 * Text is rendered progressively as markdown every 100ms.
 *
 * @param {HTMLElement} contentElement - The message content element
 * @param {string} text - The text to append
 * @returns {HTMLElement} The text container element
 */
function appendStreamingText(contentElement, text) {
  // Remove initial cursor if still present
  const cursor = contentElement.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();

  // Get or create text container (visible during streaming now)
  let textContainer = contentElement.querySelector('.text-content');
  if (!textContainer) {
    textContainer = document.createElement('div');
    textContainer.className = 'text-content';
    contentElement.appendChild(textContainer);
    // Initialize streaming state
    streamingTextContainer = textContainer;
    streamingRawText = '';
    lastRenderedText = '';
    toolsExecutedSinceLastText = false;
    startStreamingInterval();
  }

  // Ensure streaming indicator exists and is visible (hidden during tool execution)
  let indicator = contentElement.querySelector('.streaming-indicator');
  if (!indicator) {
    indicator = createStreamingIndicator();
    contentElement.appendChild(indicator);
  } else {
    // Re-show indicator if it was hidden during tool execution
    indicator.style.display = '';
  }

  // Accumulate raw text (both in module state and dataset for sidebar.js)
  // Add paragraph break if resuming text after tool execution
  if (toolsExecutedSinceLastText && streamingRawText.length > 0) {
    streamingRawText += '\n\n';
    toolsExecutedSinceLastText = false;
  } else if (streamingRawText.length > 0 && text.length > 0) {
    // Fix sentence boundary: if previous ends with punctuation and new text starts with capital, add space
    const lastChar = streamingRawText[streamingRawText.length - 1];
    const firstChar = text[0];
    const isPunctuation = /[.!?;:]/.test(lastChar);
    const startsWithCapital = /[A-Z]/.test(firstChar);
    if (isPunctuation && startsWithCapital) {
      streamingRawText += ' ';
    }
  }
  streamingRawText += text;
  textContainer.dataset.rawText = streamingRawText;

  // Update status indicator
  updateStreamingIndicator(indicator, streamingRawText);

  return textContainer;
}

// ========== Main Stream Handlers ==========

/**
 * Handles streaming text delta events.
 * Guards against undefined text and only updates DOM for the streaming tab.
 *
 * @param {string} text - The text delta to process
 * @param {Object} state - Current streaming state
 * @param {number} state.currentTabId - The currently active tab ID
 * @param {number|null} state.streamingTabId - The tab ID where streaming started
 * @param {Object} elements - DOM elements
 * @param {HTMLElement} elements.chatContainer - The chat container element
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.scrollToBottom] - Function to scroll chat to bottom
 */
function handleDelta(text, state, elements, callbacks = {}) {
  // Guard against undefined/null text
  if (text === undefined || text === null) {
    console.warn('Received undefined text delta');
    return;
  }

  // Only update DOM if we're on the tab that started the stream
  if (!Helpers.isCurrentTab(state.currentTabId, state.streamingTabId)) {
    return; // Stream content will be applied when user returns to streaming tab
  }

  const msgElement = elements.chatContainer.querySelector('.message.assistant:last-child');
  if (!msgElement) {
    console.warn('No assistant message element found');
    return;
  }

  const contentElement = msgElement.querySelector('.message-content');
  appendStreamingText(contentElement, text);

  if (callbacks.scrollToBottom) {
    callbacks.scrollToBottom(elements.chatContainer);
  } else {
    RenderUtils.scrollToBottom(elements.chatContainer);
  }
}

/**
 * Handles tool use events during streaming.
 * Updates the streaming indicator and adds tool to activity log.
 *
 * @param {Object} toolUse - The tool use object
 * @param {string} toolUse.name - The tool name
 * @param {Object} toolUse.input - The tool input parameters
 * @param {string} toolUse.id - The tool call ID
 * @param {Object} state - Current streaming state
 * @param {number} state.currentTabId - The currently active tab ID
 * @param {number|null} state.streamingTabId - The tab ID where streaming started
 * @param {string} state.autonomyMode - Current autonomy mode ('ask' or 'auto')
 * @param {Object} elements - DOM elements
 * @param {HTMLElement} elements.chatContainer - The chat container element
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.createToolCallElement] - Function to create tool element
 * @param {Function} [callbacks.scrollToBottom] - Function to scroll chat to bottom
 * @param {Function} [callbacks.isHighRiskTool] - Function to check if tool is high-risk
 */
function handleToolUse(toolUse, state, elements, callbacks = {}) {
  // Only update DOM if we're on the tab that started the stream
  if (!Helpers.isCurrentTab(state.currentTabId, state.streamingTabId)) {
    return;
  }

  const msgElement = elements.chatContainer.querySelector('.message.assistant:last-child');
  if (!msgElement) return;

  const contentElement = msgElement.querySelector('.message-content');

  // Remove cursor
  const cursor = contentElement.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();

  // Hide streaming indicator when tools are running - activity log shows status
  const indicator = contentElement.querySelector('.streaming-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }

  // Mark that tools have been used - next text should start a new paragraph
  toolsExecutedSinceLastText = true;

  // Add tool call to activity log
  if (callbacks.createToolCallElement) {
    const toolElement = callbacks.createToolCallElement(toolUse.name, toolUse.input, toolUse.id);
    contentElement.appendChild(toolElement);
  }

  if (callbacks.scrollToBottom) {
    callbacks.scrollToBottom(elements.chatContainer);
  } else {
    RenderUtils.scrollToBottom(elements.chatContainer);
  }

  // Check if confirmation is needed (handled by background script)
  // if (state.autonomyMode === 'ask' && callbacks.isHighRiskTool?.(toolUse.name)) { }
}

/**
 * Handles tool result events.
 * Updates the tool in the activity log with the result.
 *
 * @param {string} toolUseId - The tool use ID
 * @param {*} result - The tool result
 * @param {boolean} isError - Whether the result is an error
 * @param {Object} state - Current streaming state
 * @param {number} state.currentTabId - The currently active tab ID
 * @param {number|null} state.streamingTabId - The tab ID where streaming started
 * @param {Object} elements - DOM elements
 * @param {HTMLElement} elements.chatContainer - The chat container element
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.updateToolResult] - Function to update tool result in activity log
 * @param {Function} [callbacks.updateActivityCount] - Function to update activity count
 * @param {Function} [callbacks.forceScrollToBottom] - Function to force scroll to bottom
 */
function handleResult(toolUseId, result, isError, state, elements, callbacks = {}) {
  // Only update DOM if we're on the tab that started the stream
  if (!Helpers.isCurrentTab(state.currentTabId, state.streamingTabId)) {
    return;
  }

  // Update the tool in activity log
  if (callbacks.updateToolResult) {
    callbacks.updateToolResult(toolUseId, result, isError);
  }

  // Update the activity log count
  requestAnimationFrame(() => {
    const activityLog = elements.chatContainer.querySelector('.activity-log');
    if (activityLog && callbacks.updateActivityCount) {
      callbacks.updateActivityCount(activityLog);
    }
  });

  if (callbacks.forceScrollToBottom) {
    callbacks.forceScrollToBottom(elements.chatContainer);
  } else {
    RenderUtils.forceScrollToBottom(elements.chatContainer);
  }
}

/**
 * Handles stream error events.
 * Displays error message and resets streaming state.
 *
 * @param {string} error - The error message
 * @param {Object} state - Current streaming state
 * @param {number} state.currentTabId - The currently active tab ID
 * @param {number|null} state.streamingTabId - The tab ID where streaming started
 * @param {Object} elements - DOM elements
 * @param {HTMLElement} elements.chatContainer - The chat container element
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.resetStreamingState] - Function to reset streaming state
 */
function handleError(error, state, elements, callbacks = {}) {
  // Stop streaming interval on error
  stopStreamingInterval();

  // Only update DOM if we're on the tab that started the stream
  if (!Helpers.isCurrentTab(state.currentTabId, state.streamingTabId)) {
    // Still reset streaming state even if on different tab
    if (callbacks.resetStreamingState) {
      callbacks.resetStreamingState();
    }
    return;
  }

  const msgElement = elements.chatContainer.querySelector('.message.assistant:last-child');
  if (!msgElement) return;

  const contentElement = msgElement.querySelector('.message-content');

  // Remove cursor
  const cursor = contentElement.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();

  // Show error
  addErrorToMessage(contentElement, error);

  if (callbacks.resetStreamingState) {
    callbacks.resetStreamingState();
  }
}

// ========== Complexity Score Functions ==========

/**
 * Parses complexity score from response text.
 * Looks for HTML comment format: <!--COMPLEXITY:0.xx-->
 *
 * @param {string} text - The text to parse
 * @returns {number|null} The complexity score (0-1) or null if not found
 */
function parseComplexityScore(text) {
  const match = text.match(/<!--COMPLEXITY:([\d.]+)-->/);
  if (match) {
    const score = parseFloat(match[1]);
    if (!isNaN(score) && score >= 0 && score < 1) {
      return score;
    }
  }
  return null;
}

/**
 * Strips complexity score comment from text for display.
 *
 * @param {string} text - The text to clean
 * @returns {string} Text with complexity score removed
 */
function stripComplexityScore(text) {
  return text.replace(/<!--COMPLEXITY:[\d.]+-->\s*/g, '');
}

/**
 * Adds footer to message with optional complexity score and extract specs button.
 *
 * @param {HTMLElement} msgElement - The message element
 * @param {number|null} score - The complexity score (0-1), or null to hide complexity display
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.onExtractSpecs] - Callback for extract specs button
 */
function addComplexityFooter(msgElement, score, callbacks = {}) {
  const footer = document.createElement('div');
  footer.className = 'message-footer complexity-footer';

  // Build complexity display only if score provided
  let complexityHtml = '';
  if (score !== null && score !== undefined) {
    const scoreDisplay = score.toFixed(2);
    const barWidth = Math.round(score * 100);
    complexityHtml = `
      <span class="complexity-label">Complexity:</span>
      <span class="complexity-bar">
        <span class="complexity-fill" style="width: ${barWidth}%"></span>
      </span>
      <span class="complexity-value">${scoreDisplay}</span>
    `;
  }

  footer.innerHTML = `
    ${complexityHtml}
    <button class="analyze-specs-btn" title="Extract Site Specs from conversation">Extract Specs</button>
    <span class="complexity-status"></span>
  `;

  // Add click handler for extract specs button
  const extractBtn = footer.querySelector('.analyze-specs-btn');
  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = '...';
    if (callbacks.onExtractSpecs) {
      await callbacks.onExtractSpecs(msgElement);
    }
    extractBtn.style.display = 'none'; // Hide button after extraction
  });

  msgElement.appendChild(footer);
}

/**
 * Processes complexity score from text and adds footer if found.
 *
 * @param {string} text - The text to process
 * @param {HTMLElement} msgElement - The message element
 * @param {Object} [callbacks] - Optional callback functions
 * @returns {string} Text with complexity score stripped
 */
function processComplexity(text, msgElement, callbacks = {}) {
  const complexityScore = parseComplexityScore(text);
  const strippedText = stripComplexityScore(text);

  if (complexityScore !== null) {
    addComplexityFooter(msgElement, complexityScore, callbacks);
  }

  return strippedText;
}

/**
 * Updates complexity footer status text and type.
 *
 * @param {HTMLElement} msgElement - The message element
 * @param {string} status - The status text
 * @param {string} [type='info'] - The status type ('info', 'success', 'error')
 */
function updateComplexityFooterStatus(msgElement, status, type = 'info') {
  const statusEl = msgElement.querySelector('.complexity-status');
  if (statusEl) {
    statusEl.textContent = status ? `· ${status}` : '';
    statusEl.className = `complexity-status ${type}`;
  }
}

/**
 * Handles manual spec extraction from a message.
 * Extracts conversation context and sends to background for processing.
 *
 * @param {HTMLElement} msgElement - The message element to extract from
 * @param {HTMLElement} chatContainer - The chat container element
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.getCurrentDomain] - Function to get current domain
 * @param {Function} [callbacks.updateNotesBadge] - Function to update notes badge
 * @returns {Promise<void>}
 */
async function handleManualSpecExtraction(msgElement, chatContainer, callbacks = {}) {
  updateComplexityFooterStatus(msgElement, 'analyzing...', 'info');

  try {
    // Get message content for extraction
    const messages = Array.from(chatContainer.querySelectorAll('.message'));
    const msgIndex = messages.indexOf(msgElement);

    const assistantContent = msgElement.querySelector('.message-content');
    const assistantText = assistantContent?.textContent || '';

    // Find preceding user message
    let userText = '';
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].classList.contains('user')) {
        userText = messages[i].querySelector('.message-content')?.textContent || '';
        break;
      }
    }

    // Get tool calls from activity log
    const activityLog = assistantContent?.querySelector('.activity-log');
    let toolInfo = '';
    if (activityLog) {
      const toolItems = activityLog.querySelectorAll('.activity-item');
      toolItems.forEach(item => {
        const name = item.querySelector('.activity-item-name')?.textContent || '';
        const details = item.querySelector('.activity-detail-content')?.textContent || '';
        if (name) {
          toolInfo += `Tool: ${name}\n`;
          if (details) toolInfo += `Input: ${details.slice(0, 300)}\n`;
        }
      });
    }

    // Get current domain
    let domain = null;
    if (callbacks.getCurrentDomain) {
      domain = await callbacks.getCurrentDomain();
    }
    if (!domain) {
      updateComplexityFooterStatus(msgElement, 'no valid domain', 'info');
      return;
    }

    // Send to background for spec extraction
    const result = await browser.runtime.sendMessage({
      type: 'EXTRACT_NOTE',
      domain: domain,
      userRequest: userText,
      assistantResponse: assistantText,
      toolCalls: toolInfo
    });

    if (result?.success) {
      const specCount = result.count || 1;
      updateComplexityFooterStatus(msgElement, `saved ${specCount} spec${specCount > 1 ? 's' : ''}`, 'success');
      if (callbacks.updateNotesBadge) {
        callbacks.updateNotesBadge();
      }
    } else if (result?.error?.includes('No useful patterns') || result?.error?.includes('NO_USEFUL_PATTERNS')) {
      updateComplexityFooterStatus(msgElement, 'no new patterns', 'info');
    } else {
      updateComplexityFooterStatus(msgElement, result?.error || 'analysis failed', 'error');
    }
  } catch (error) {
    console.error('[Analyze] Extraction error:', error);
    updateComplexityFooterStatus(msgElement, 'analysis failed', 'error');
  }
}

// ========== Message Finalization ==========

/**
 * Finalizes a message by rendering final content.
 * Activity log stays at top, text content rendered with markdown.
 *
 * @param {HTMLElement} contentElement - The message content element
 * @param {string} finalText - The final text to render
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.renderMarkdownContent] - Function to render markdown
 */
function finalizeMessage(contentElement, finalText, callbacks = {}) {
  // Stop streaming interval and clean up state
  stopStreamingInterval();

  // Remove streaming cursor and indicator
  const cursor = contentElement.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();
  const indicator = contentElement.querySelector('.streaming-indicator');
  if (indicator) indicator.remove();

  // Get text container
  const textContainer = contentElement.querySelector('.text-content');

  // Final render with complete text
  if (textContainer && finalText) {
    const activityLog = contentElement.querySelector('.activity-log');

    // Clear text container
    textContainer.innerHTML = '';

    // Activity log first (if exists)
    if (activityLog) {
      textContainer.appendChild(activityLog);
    }

    // Parse <answer> tags and render with distinct styling
    const render = callbacks.renderMarkdownContent || RenderUtils.renderMarkdownContent;
    const answerMatch = finalText.match(/<answer>([\s\S]*?)<\/answer>/);

    if (answerMatch) {
      // Split into working notes and answer
      const beforeAnswer = finalText.substring(0, answerMatch.index).trim();
      const answerContent = answerMatch[1].trim();

      // Render working notes (if any)
      if (beforeAnswer) {
        const workingDiv = document.createElement('div');
        workingDiv.className = 'response-text working-notes';
        workingDiv.innerHTML = render(beforeAnswer);
        textContainer.appendChild(workingDiv);
      }

      // Render answer with emphasis
      const answerDiv = document.createElement('div');
      answerDiv.className = 'response-text answer-content';
      answerDiv.innerHTML = render(answerContent);
      textContainer.appendChild(answerDiv);
    } else {
      // No <answer> tags - render as before
      const textDiv = document.createElement('div');
      textDiv.className = 'response-text';
      textDiv.innerHTML = render(finalText);
      textContainer.appendChild(textDiv);
    }
  }
}

/**
 * Triggers continuation after stream ends if needed.
 *
 * @param {Object} state - Current state
 * @param {number|null} state.pendingTabSwitch - Tab to switch to after streaming
 * @param {number} state.currentTabId - Current tab ID
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.saveCurrentTabState] - Save current tab state
 * @param {Function} [callbacks.loadTabState] - Load tab state for new tab
 * @param {Function} [callbacks.updateNotesBadge] - Update notes badge
 * @param {Function} [callbacks.updateTabInfo] - Update tab info display
 */
function triggerContinuation(state, callbacks = {}) {
  // If a tab was created during streaming, switch to it now
  if (state.pendingTabSwitch && state.pendingTabSwitch !== state.currentTabId) {
    console.log('[TabSwitch] Streaming complete, switching to pending tab', state.pendingTabSwitch);
    if (callbacks.saveCurrentTabState) {
      callbacks.saveCurrentTabState();
    }
    // Note: currentTabId update should be handled by caller
    if (callbacks.loadTabState) {
      callbacks.loadTabState(state.pendingTabSwitch);
    }
    if (callbacks.updateNotesBadge) {
      callbacks.updateNotesBadge();
    }
    if (callbacks.updateTabInfo) {
      callbacks.updateTabInfo();
    }
  }
}

// ========== Message Creation Functions ==========

/**
 * Creates a message element for display in the chat.
 *
 * @param {string} role - The message role ('user' or 'assistant')
 * @param {string} content - The message content
 * @param {Object|null} [image] - Optional image attachment
 * @param {string} image.base64 - Base64 encoded image data
 * @param {string} image.mediaType - Image MIME type
 * @param {Object} [callbacks] - Optional callback functions
 * @param {Function} [callbacks.onCopyTask] - Callback for copy task button click
 * @returns {HTMLElement} The created message element
 */
function createMessageElement(role, content, image = null, callbacks = {}) {
  const msgElement = document.createElement('div');
  msgElement.className = `message ${role}`;

  const contentElement = document.createElement('div');
  contentElement.className = 'message-content';

  // For user messages with images, show the image
  if (role === 'user' && image) {
    const imgContainer = document.createElement('div');
    imgContainer.className = 'message-image-container';
    const img = document.createElement('img');
    img.className = 'message-image';
    img.src = `data:${image.mediaType};base64,${image.base64}`;
    img.alt = 'Attached image';
    imgContainer.appendChild(img);
    contentElement.appendChild(imgContainer);

    // Add text below image if present
    if (content && content !== '[Image]') {
      const textDiv = document.createElement('div');
      textDiv.className = 'message-text';
      textDiv.innerHTML = RenderUtils.escapeHtml(content);
      contentElement.appendChild(textDiv);
    }
  } else {
    contentElement.innerHTML = role === 'user' ? RenderUtils.escapeHtml(content) : RenderUtils.renderMarkdown(content);
  }

  // Add action buttons for assistant messages
  if (role === 'assistant') {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actionsDiv.innerHTML = `
      <button class="msg-action-btn copy-task-btn" title="Copy task as JSON">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      </button>
    `;
    msgElement.appendChild(actionsDiv);

    // Add click handler for copy task button
    if (callbacks.onCopyTask) {
      const copyTaskBtn = actionsDiv.querySelector('.copy-task-btn');
      copyTaskBtn.addEventListener('click', () => callbacks.onCopyTask(msgElement));
    }
  }

  msgElement.appendChild(contentElement);
  return msgElement;
}

/**
 * Adds a message element to the chat UI.
 *
 * @param {string} role - The message role
 * @param {string} content - The message content
 * @param {HTMLElement} chatContainer - The chat container element
 * @param {Object|null} [image] - Optional image attachment
 * @param {Object} [callbacks] - Optional callback functions
 * @returns {HTMLElement} The added message element
 */
function addMessageToUI(role, content, chatContainer, image = null, callbacks = {}) {
  const msgElement = createMessageElement(role, content, image, callbacks);
  chatContainer.appendChild(msgElement);
  RenderUtils.scrollToBottom(chatContainer);
  return msgElement;
}

/**
 * Adds an error message to a content element.
 *
 * @param {HTMLElement} contentElement - The content element
 * @param {string} errorText - The error text to display
 */
function addErrorToMessage(contentElement, errorText) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'message-error';
  errorDiv.textContent = errorText;
  contentElement.appendChild(errorDiv);
}

// ========== Module Export ==========

/**
 * Stream Renderer API exposed for MV2 compatibility.
 */
window.StreamRenderer = {
  // Main handlers
  handleDelta,
  handleToolUse,
  handleResult,
  handleError,

  // Message creation
  createMessageElement,
  addMessageToUI,
  addErrorToMessage,

  // Complexity scoring
  parseComplexityScore,
  stripComplexityScore,
  addComplexityFooter,
  updateComplexityFooterStatus,
  handleManualSpecExtraction,

  // Helpers
  createStreamingIndicator,
  updateStreamingIndicator,
  updateStreamingIndicatorWithTool,
  appendStreamingText,
  processComplexity,
  finalizeMessage,
  triggerContinuation,

  // Constants
  TOOL_LABELS
};

