/**
 * Message Handler Module
 * Handles inbound messages from the background script.
 * Uses a route table pattern for clean message dispatch.
 */

/**
 * Route table mapping message types to their handlers.
 * Each handler receives the message and a context object with dependencies.
 *
 * @type {Object.<string, function(Object, Object): void>}
 */
const MESSAGE_HANDLERS = {
  'STREAM_DELTA': (msg, ctx) => ctx.streamRenderer.handleDelta(msg.text),
  'STREAM_TOOL_USE': (msg, ctx) => ctx.streamRenderer.handleToolUse({
    id: msg.toolId,
    name: msg.toolName,
    input: msg.toolInput
  }),
  'STREAM_END': (_msg, ctx) => ctx.streamRenderer.handleEnd(),
  'STREAM_ERROR': (msg, ctx) => ctx.streamRenderer.handleError(msg.error),
  'TOOL_RESULT': (msg, ctx) => ctx.activityLog.updateResult(msg.toolId, msg.result, msg.isError),
  'CONFIRM_TOOL': (msg, ctx) => ctx.modalManager.showConfirmation(msg.toolName, msg.toolInput, msg.toolId),
  'TOKEN_USAGE': (msg, ctx) => ctx.tokenDisplay.update(
    msg.inputTokens,
    msg.outputTokens,
    msg.cacheCreationTokens,
    msg.cacheReadTokens
  ),
  'ITERATION_LIMIT_REACHED': (msg, ctx) => showIterationLimitPrompt(msg.promptId, msg.currentIteration, ctx),
  'TAB_CREATED_BY_TOOL': (msg, ctx) => handleTabCreated(msg, ctx)
};

/**
 * Main message dispatcher for background script messages.
 * Filters messages by window ID and routes to appropriate handler.
 *
 * @param {Object} message - Message from background script
 * @param {string} message.type - Message type identifier
 * @param {number} [message.windowId] - Target window ID for filtering
 * @param {Object} context - Handler context with dependencies
 * @param {number} context.currentWindowId - Current sidebar window ID
 * @returns {void}
 */
function handleBackgroundMessage(message, context) {
  // Filter out messages meant for other windows (multi-window support)
  if (message.windowId !== undefined && message.windowId !== context.currentWindowId) {
    return;
  }

  console.log('[Sidebar] Received message:', message.type, message);

  const handler = MESSAGE_HANDLERS[message.type];
  if (handler) {
    handler(message, context);
  } else {
    console.warn('[MessageHandler] Unknown message type:', message.type);
  }
}

/**
 * Handles tab created by tool during streaming.
 * Defers tab switch until streaming completes to ensure tool results display properly.
 *
 * @param {Object} msg - Tab created message
 * @param {number} msg.tabId - ID of the newly created tab
 * @param {Object} ctx - Handler context
 */
function handleTabCreated(msg, ctx) {
  if (msg.tabId && msg.tabId !== ctx.state.currentTabId) {
    if (ctx.state.isStreaming) {
      ctx.state.pendingTabSwitch = msg.tabId;
      console.log('[TabSwitch] Deferring switch to tab', msg.tabId, 'until streaming completes');
    } else {
      ctx.tabManager.saveCurrentState();
      ctx.state.currentTabId = msg.tabId;
      ctx.tabManager.loadState(msg.tabId);
      ctx.updateNotesBadge();
      ctx.updateTabInfo();
    }
  }
}

/**
 * Shows iteration limit prompt when Claude reaches the configured action limit.
 * Presents buttons to allow more iterations or stop and summarize.
 *
 * @param {string} promptId - Unique ID for this prompt (for response correlation)
 * @param {number} currentIteration - Number of iterations completed
 * @param {Object} ctx - Handler context
 * @param {HTMLElement} ctx.chatContainer - Chat container element
 * @param {function} ctx.scrollToBottom - Function to scroll chat to bottom
 */
function showIterationLimitPrompt(promptId, currentIteration, ctx) {
  // Remove any existing iteration prompt
  const existingPrompt = ctx.chatContainer.querySelector('.iteration-prompt');
  if (existingPrompt) existingPrompt.remove();

  const promptElement = document.createElement('div');
  promptElement.className = 'message system iteration-prompt';
  promptElement.dataset.iteration = currentIteration; // Store for cancel restore
  promptElement.innerHTML = `
    <div class="message-content">
      <div class="iteration-prompt-content">
        <div class="iteration-prompt-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Action limit reached (${currentIteration} tool calls)</span>
        </div>
        <p class="iteration-prompt-text">Claude has made ${currentIteration} tool calls. Allow more?</p>
        <div class="iteration-prompt-buttons">
          <div class="iteration-more-buttons">
            <button class="iteration-btn" data-allow="10">+10 more</button>
            <button class="iteration-btn unlimited-btn" data-allow="-1">Unlimited</button>
            <button class="iteration-btn stop-now-btn" data-allow="-2">Stop</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add click handlers
  const buttons = promptElement.querySelectorAll('.iteration-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const allowMore = parseInt(btn.dataset.allow, 10);

      // Special handling for unlimited (-1) - requires confirmation
      if (allowMore === -1) {
        showUnlimitedConfirmation(promptId, promptElement, ctx);
        return;
      }

      respondToIterationPrompt(promptId, allowMore, ctx);
      promptElement.remove();
    });
  });

  ctx.chatContainer.appendChild(promptElement);
  ctx.scrollToBottom();
}

/**
 * Shows confirmation dialog for unlimited actions.
 * Warns user about potential high token usage.
 *
 * @param {string} promptId - Unique ID for this prompt
 * @param {HTMLElement} promptElement - The iteration prompt element to remove on confirm
 * @param {Object} ctx - Handler context
 */
function showUnlimitedConfirmation(promptId, promptElement, ctx) {
  // Replace the buttons with confirmation UI
  const buttonsDiv = promptElement.querySelector('.iteration-prompt-buttons');
  buttonsDiv.innerHTML = `
    <div class="unlimited-warning">
      <div class="unlimited-warning-icon">⚠️</div>
      <div class="unlimited-warning-text">
        <strong>Are you sure?</strong>
        <p>Unlimited mode removes all action limits. Claude will continue until the task is complete, which could use a large number of tokens without further prompts.</p>
      </div>
    </div>
    <div class="unlimited-confirm-buttons">
      <button class="iteration-btn cancel-unlimited-btn">Cancel</button>
      <button class="iteration-btn confirm-unlimited-btn">Yes, allow unlimited actions</button>
    </div>
  `;

  // Handle cancel - restore original buttons
  buttonsDiv.querySelector('.cancel-unlimited-btn').addEventListener('click', () => {
    // Remove and re-show the prompt with original iteration count
    const iteration = parseInt(promptElement.dataset.iteration, 10) || 0;
    promptElement.remove();
    showIterationLimitPrompt(promptId, iteration, ctx);
  });

  // Handle confirm
  buttonsDiv.querySelector('.confirm-unlimited-btn').addEventListener('click', () => {
    respondToIterationPrompt(promptId, -1, ctx);
    promptElement.remove();
  });

  ctx.scrollToBottom();
}

/**
 * Sends response to iteration limit prompt to background script.
 * Shows feedback message indicating the action taken.
 *
 * @param {string} promptId - Unique ID for this prompt
 * @param {number} allowMore - Number of additional iterations to allow (0 to stop, -1 for unlimited)
 * @param {Object} ctx - Handler context
 * @param {function} ctx.addEphemeralMessage - Function to show temporary message
 */
function respondToIterationPrompt(promptId, allowMore, ctx) {
  browser.runtime.sendMessage({
    type: 'ITERATION_LIMIT_RESPONSE',
    promptId: promptId,
    allowMore: allowMore
  });

  // Show feedback message
  if (allowMore === -1) {
    ctx.addEphemeralMessage('⚠️ Unlimited mode enabled - no further prompts until task completes', 'warning', 5000);
  } else if (allowMore === -2) {
    ctx.addEphemeralMessage('Stopped.', 'info', 2000);
  } else if (allowMore > 0) {
    ctx.addEphemeralMessage(`Allowing ${allowMore} more actions...`, 'info', 3000);
  } else {
    ctx.addEphemeralMessage('Stopping and generating summary...', 'info', 3000);
  }
}

/**
 * Creates the MessageHandler module.
 *
 * @param {Object} context - Context object with all dependencies
 * @returns {Object} MessageHandler API
 */
function createMessageHandler(context) {
  return {
    /**
     * Handles incoming message from background script.
     *
     * @param {Object} message - The message to handle
     */
    handle: (message) => handleBackgroundMessage(message, context),

    /**
     * Shows iteration limit prompt manually.
     *
     * @param {string} promptId - Prompt ID
     * @param {number} currentIteration - Current iteration count
     */
    showIterationPrompt: (promptId, currentIteration) =>
      showIterationLimitPrompt(promptId, currentIteration, context),

    /**
     * Responds to iteration prompt manually.
     *
     * @param {string} promptId - Prompt ID
     * @param {number} allowMore - Iterations to allow
     */
    respondToIterationPrompt: (promptId, allowMore) =>
      respondToIterationPrompt(promptId, allowMore, context)
  };
}

// Export to window for MV2 compatibility
window.MessageHandler = {
  create: createMessageHandler,
  MESSAGE_HANDLERS
};
