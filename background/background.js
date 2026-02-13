/**
 * Foxhole for Claude - Background Script
 * Main coordinator for Claude API, tool execution, and sidebar communication
 */

(function() {
  'use strict';

  // State
  let claudeApi = null;
  let defaultAutonomyMode = 'ask'; // Global default for new tabs
  const tabAutonomyModes = new Map(); // tabId -> autonomyMode (per-tab setting)

  // Get autonomy mode for a specific tab (falls back to default)
  function getAutonomyMode(tabId) {
    return tabAutonomyModes.get(tabId) || defaultAutonomyMode;
  }
  let configuredMaxToolIterations = 15; // User's configured setting (from storage)
  let currentTaskMaxIterations = 15; // Effective limit for current task (may be increased by user during task)
  let currentTaskToolCallCount = 0; // Actual tool call count for current task
  const HARD_TOOL_CALL_CAP = 200; // Absolute maximum tool calls even in "unlimited" mode
  let configuredHighRiskTools = ['click_element', 'type_text', 'navigate', 'execute_script', 'fill_form', 'press_key']; // Default high-risk tools
  let debugMode = false; // Log full API requests when enabled
  let pendingToolConfirmations = new Map();
  let pendingIterationPrompts = new Map(); // For iteration limit prompts
  let activeStreams = new Map(); // tabId -> abort controller
  let currentStreamWindowId = null; // Window ID for targeted message sending

  // Task history - sliding window of last 5 completed tasks (return last 3 on request)
  // Each entry: { userMessage: string, assistantResponse: string, timestamp: number }
  const taskHistory = [];
  const MAX_TASK_HISTORY = 5;
  let currentTaskUserMessage = null;  // Track original user request for current task

  /**
   * Get the last 3 task summaries for context (called by tool-router.js)
   * @returns {Array} Last 3 tasks, most recent first
   */
  function getTaskHistory() {
    // Return last 3 tasks (most recent first)
    return taskHistory.slice(-3).reverse();
  }

  /**
   * Add a completed task to history
   * @param {string} userMessage - Original user request
   * @param {string} assistantResponse - Final assistant response (stripped of work tags)
   */
  function addTaskToHistory(userMessage, assistantResponse) {
    if (!userMessage || !assistantResponse) {
      console.warn('[TaskHistory] Missing userMessage or assistantResponse, skipping');
      return;
    }

    // Strip <work> tags from response before storing
    const cleanResponse = assistantResponse
      .replace(/<work>[\s\S]*?<\/work>/gi, '')
      .trim();

    // Don't store if response is empty after stripping
    if (!cleanResponse) {
      console.warn('[TaskHistory] Response empty after stripping work tags, skipping');
      return;
    }

    const task = {
      userMessage: userMessage.slice(0, 500),  // Truncate long messages
      assistantResponse: cleanResponse.slice(0, 1000),  // Truncate long responses
      timestamp: Date.now()
    };

    taskHistory.push(task);
    console.log(`[TaskHistory] Added task: "${task.userMessage.slice(0, 50)}..." (${taskHistory.length} total)`);

    // Maintain sliding window
    if (taskHistory.length > MAX_TASK_HISTORY) {
      taskHistory.shift();
    }
  }

  // Expose getTaskHistory for tool-router.js
  window.getTaskHistory = getTaskHistory;

  // Initialize on extension load
  init();

  async function init() {
    await loadPrompts();  // Load prompt templates first
    await loadSettings();
    setupMessageListeners();
    setupBrowserAction();
    setupTabCleanup();
    console.log('Foxhole for Claude background script initialized');
  }

  // Clean up per-tab state when tabs are closed
  function setupTabCleanup() {
    browser.tabs.onRemoved.addListener((tabId) => {
      tabAutonomyModes.delete(tabId);
    });
  }

  /**
   * Sanitize conversation to prevent API errors.
   * - Removes messages with empty content
   * - Ensures text blocks are non-empty (API rejects empty text blocks)
   * - Merges consecutive user messages if needed
   */
  function sanitizeConversation(conversation) {
    if (!Array.isArray(conversation)) return [];

    const sanitized = [];
    for (const msg of conversation) {
      if (!msg || !msg.role) continue;

      // Handle string content (simple format)
      if (typeof msg.content === 'string') {
        if (msg.content.trim()) {
          sanitized.push(msg);
        }
        continue;
      }

      // Handle array content (content blocks)
      if (Array.isArray(msg.content)) {
        const validBlocks = msg.content.filter(block => {
          if (!block || !block.type) return false;
          // Text blocks must be non-empty
          if (block.type === 'text') {
            return block.text && block.text.trim();
          }
          // Tool use and tool result blocks are valid if they have required fields
          if (block.type === 'tool_use') {
            return block.id && block.name;
          }
          if (block.type === 'tool_result') {
            return block.tool_use_id;
          }
          return true;
        });

        if (validBlocks.length > 0) {
          sanitized.push({ ...msg, content: validBlocks });
        }
        continue;
      }

      // Unknown content type - skip
      console.warn('[Sanitize] Skipping message with invalid content:', msg);
    }

    // Check for consecutive messages from same role (can cause issues)
    for (let i = 1; i < sanitized.length; i++) {
      if (sanitized[i].role === sanitized[i - 1].role && sanitized[i].role === 'user') {
        console.warn('[Sanitize] Found consecutive user messages at index', i);
      }
    }

    return sanitized;
  }

  // Setup browser action click to toggle sidebar
  function setupBrowserAction() {
    browser.browserAction.onClicked.addListener(() => {
      browser.sidebarAction.toggle();
    });
  }

  // Default values for ClaudeAPI
  const API_DEFAULTS = {
    model: 'claude-haiku-4-5',
    temperature: 0,
    maxTokens: 8192
  };

  // Create ClaudeAPI instance from storage or provided values
  async function createClaudeApiFromStorage(overrides = {}) {
    const result = await browser.storage.local.get(['apiKey', 'defaultModel', 'temperature', 'maxTokens']);
    if (!result.apiKey && !overrides.apiKey) return null;

    return new ClaudeAPI(
      overrides.apiKey || result.apiKey,
      overrides.model || result.defaultModel || API_DEFAULTS.model,
      overrides.temperature ?? result.temperature ?? API_DEFAULTS.temperature,
      overrides.maxTokens || result.maxTokens || API_DEFAULTS.maxTokens
    );
  }

  // Load settings from storage
  async function loadSettings() {
    try {
      const result = await browser.storage.local.get([
        'apiKey',
        'defaultModel',
        'autonomyMode',
        'maxTokens',
        'maxToolIterations',
        'temperature',
        'highRiskTools',
        'debugMode'
      ]);

      if (result.apiKey) {
        claudeApi = await createClaudeApiFromStorage();
      }

      if (result.autonomyMode) {
        defaultAutonomyMode = result.autonomyMode;
      }

      if (result.maxToolIterations) {
        configuredMaxToolIterations = result.maxToolIterations;
        currentTaskMaxIterations = result.maxToolIterations;
      }

      if (result.highRiskTools) {
        configuredHighRiskTools = result.highRiskTools;
      }

      // Debug mode - log full API requests
      debugMode = result.debugMode === true;
      window.debugMode = debugMode;
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  // Setup message listeners
  function setupMessageListeners() {
    browser.runtime.onMessage.addListener(handleMessage);

    // Listen for storage changes to update settings
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;

      if (changes.apiKey) {
        claudeApi = changes.apiKey.newValue
          ? await createClaudeApiFromStorage({ apiKey: changes.apiKey.newValue })
          : null;
      }

      if (changes.defaultModel && claudeApi) {
        claudeApi.setModel(changes.defaultModel.newValue);
      }

      if (changes.temperature !== undefined && claudeApi) {
        claudeApi.setTemperature(changes.temperature.newValue);
      }

      if (changes.maxTokens && claudeApi) {
        claudeApi.setMaxTokens(changes.maxTokens.newValue);
        console.log(`[Settings] Max tokens updated to ${changes.maxTokens.newValue}`);
      }

      if (changes.autonomyMode) {
        defaultAutonomyMode = changes.autonomyMode.newValue;
      }

      if (changes.maxToolIterations) {
        configuredMaxToolIterations = changes.maxToolIterations.newValue;
        currentTaskMaxIterations = changes.maxToolIterations.newValue;
        console.log(`[Settings] Max tool iterations updated to ${configuredMaxToolIterations}`);
      }

      if (changes.highRiskTools) {
        configuredHighRiskTools = changes.highRiskTools.newValue;
        console.log(`[Settings] High-risk tools updated:`, configuredHighRiskTools);
      }

      if (changes.debugMode !== undefined) {
        debugMode = changes.debugMode.newValue === true;
        window.debugMode = debugMode;
        console.log(`[Settings] Debug mode: ${debugMode ? 'ON' : 'OFF'}`);
      }
    });
  }

  // Handle messages from sidebar and content scripts
  async function handleMessage(message, sender) {
    const { type, ...payload } = message;

    switch (type) {
      case 'CHAT_MESSAGE':
        handleChatMessage(payload, sender);
        return true;

      case 'SET_AUTONOMY_MODE':
        // Store per-tab autonomy mode
        if (payload.tabId) {
          tabAutonomyModes.set(payload.tabId, payload.mode);
        }
        return true;

      case 'TAKE_SCREENSHOT':
        return handleTakeScreenshot();

      case 'TOOL_CONFIRMATION':
        handleToolConfirmation(payload);
        return true;

      case 'ITERATION_LIMIT_RESPONSE':
        handleIterationLimitResponse(payload);
        return true;

      case 'API_KEY_UPDATED':
        await loadSettings();
        return true;

      case 'CANCEL_STREAM':
        handleCancelStream(payload.tabId);
        return true;

      case 'SETTINGS_UPDATED':
        await loadSettings();
        return true;

      case 'OPEN_DOWNLOAD':
        // User clicked button - this IS a user gesture, so downloads.open should work
        try {
          await browser.downloads.open(payload.downloadId);
          return { success: true };
        } catch (e) {
          console.error('downloads.open failed:', e);
          return { success: false, error: e.message };
        }

      // Content script messages - acknowledge but don't process
      case 'content_script_ready':
        // Content script is ready, no action needed
        return true;

      case 'console_log':
        // Store console logs from page context
        if (sender.tab?.id && window.addToConsoleBuffer) {
          window.addToConsoleBuffer(sender.tab.id, payload.data);
        }
        return true;

      case 'js_error':
        // Store JavaScript errors from page context
        if (sender.tab?.id && window.addToErrorBuffer) {
          window.addToErrorBuffer(sender.tab.id, payload.data);
        }
        return true;

      case 'websocket_message':
        // Store WebSocket messages intercepted by content script
        if (sender.tab?.id && window.addToWebsocketBuffer) {
          window.addToWebsocketBuffer(sender.tab.id, payload.data);
        }
        return true;

      case 'unhandled_rejection':
        // Store unhandled promise rejections as errors
        if (sender.tab?.id && window.addToErrorBuffer) {
          window.addToErrorBuffer(sender.tab.id, payload.data);
        }
        return true;

      // Site knowledge system (unified API)
      case 'GET_EXPERIENCES':
        return handleGetKnowledge(payload);

      case 'ADD_EXPERIENCE':
        return handleAddKnowledge(payload);

      case 'GET_EXPERIENCE_COUNT':
        return handleGetKnowledgeCount(payload);

      case 'GET_CURRENT_TAB_URL':
        return handleGetCurrentTabUrl();

      // Site knowledge handlers (kept for backward compat with sidebar)
      case 'GET_SITE_NOTES':
        return handleGetKnowledge(payload);

      case 'ADD_SITE_NOTE':
        return handleAddKnowledge(payload);

      case 'CLEAR_SITE_NOTES':
        return handleClearKnowledge(payload);

      case 'UPDATE_SITE_NOTE':
        return handleUpdateKnowledge(payload);

      case 'DELETE_SITE_NOTE':
        return handleDeleteKnowledge(payload);

      case 'SET_RAW_SITE_NOTES':
        return handleSetRawKnowledge(payload);

      case 'GET_RAW_SITE_NOTES':
        return handleGetRawKnowledge(payload);

      case 'GET_SITE_NOTES_COUNT':
        return handleGetKnowledgeCount(payload);

      case 'GET_NEW_NOTES_COUNT':
        return handleGetNewKnowledgeCount(payload);

      case 'SET_NOTES_REVIEWED':
        return handleSetKnowledgeReviewed(payload);

      case 'EXPORT_CONTEXT':
        return handleExportContext(payload);

      case 'SUMMARIZE_CONTEXT':
        return handleSummarizeContext(payload);

      case 'GET_API_PATTERN_COUNT': {
        if (!window.ApiObserver) return { count: 0 };
        const domain = payload.domain;
        if (!domain) return { count: 0 };
        const patterns = window.ApiObserver.getPatterns(domain);
        return { count: Object.keys(patterns).length };
      }

      case 'GET_INTERACTION_PATTERN_COUNT': {
        if (!window.InteractionObserver) return { count: 0 };
        const domain = payload.domain;
        if (!domain) return { count: 0 };
        return { count: window.InteractionObserver.getPatternCount(domain) };
      }

      case 'GET_OBSERVER_COUNTS': {
        const domain = payload.domain;
        if (!domain) return { api: 0, dom: 0 };
        const apiPatterns = window.ApiObserver ? window.ApiObserver.getPatterns(domain) : {};
        const domCount = window.InteractionObserver ? window.InteractionObserver.getPatternCount(domain) : 0;
        return { api: Object.keys(apiPatterns).length, dom: domCount };
      }

      default:
        // Only warn for truly unknown messages
        if (type) {
          console.debug('Unhandled message type:', type);
        }
        return false;
    }
  }

  // Handle chat message from sidebar
  async function handleChatMessage(payload, _sender) {
    const { conversation, model, windowId, autonomyMode } = payload;

    // Reset iteration limit and tool call count at start of new task
    currentTaskMaxIterations = configuredMaxToolIterations;
    currentTaskToolCallCount = 0;

    // Store window ID for targeted message sending
    currentStreamWindowId = windowId || null;

    // Get active tab for context and set its autonomy mode from sidebar
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;
    const tabUrl = tab?.url;

    // Set autonomy mode for this tab (from sidebar's current setting)
    if (tabId && autonomyMode) {
      tabAutonomyModes.set(tabId, autonomyMode);
    }

    // Lazy-load API key if not yet initialized (handles race condition on extension reload)
    if (!claudeApi) {
      console.log('[Background] claudeApi not ready, attempting to load from storage...');
      claudeApi = await createClaudeApiFromStorage();
      if (claudeApi) {
        console.log('[Background] claudeApi initialized from lazy load');
      } else {
        sendToSidebar({
          type: 'STREAM_ERROR',
          error: 'API key not configured. Please set your API key in settings.'
        });
        currentStreamWindowId = null;
        return;
      }
    }

    // Update model if different
    if (model && model !== claudeApi.model) {
      claudeApi.setModel(model);
    }

    // Create abort controller for this stream
    const abortController = new AbortController();
    if (tabId) {
      activeStreams.set(tabId, abortController);
    }

    // Sanitize conversation to remove empty content blocks (API rejects them)
    const sanitizedConversation = sanitizeConversation(conversation);

    // Capture original user message for task history
    // In the new stateless flow, conversation will have just one user message
    const userMessages = sanitizedConversation.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
      const lastUserMsg = userMessages[userMessages.length - 1];
      currentTaskUserMessage = typeof lastUserMsg.content === 'string'
        ? lastUserMsg.content
        : lastUserMsg.content.find(b => b.type === 'text')?.text || '[Image or other content]';
    }

    try {
      await streamConversation(sanitizedConversation, tabId, tabUrl, abortController.signal);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Stream error:', error);

        // Check if this is a token overflow error
        const isTokenOverflow = error.message?.includes('too long') ||
                               error.message?.includes('maximum') ||
                               error.message?.includes('tokens');

        if (isTokenOverflow) {
          sendToSidebar({
            type: 'STREAM_ERROR',
            error: 'Context too large. Try clearing the chat and starting fresh, or ask for smaller chunks of data.'
          });
        } else {
          sendToSidebar({
            type: 'STREAM_ERROR',
            error: error.message || 'Unknown error occurred'
          });
        }
      }
    } finally {
      // Disable selection mode if it was left on during the task
      if (tabId) {
        browser.tabs.sendMessage(tabId, { action: 'toggle_selection_mode', params: { enable: false } }, { frameId: 0 }).catch(() => {});
        activeStreams.delete(tabId);
      }
      // Reset window ID after stream completes
      currentStreamWindowId = null;
    }
  }

  // Stream conversation with Claude
  async function streamConversation(conversation, tabId, tabUrl, signal, iteration = 0, continuationCount = 0) {
    let currentAssistantContent = [];
    let currentTextBlock = '';
    let currentToolUse = null;
    let currentToolInputJson = '';
    let stopReason = null;
    let outputTokensUsed = 0;

    // Max continuations to prevent infinite loops
    // TODO: Externalize to settings (e.g., maxAutoContinuations: 1-5, default 3)
    const MAX_CONTINUATIONS = 3;

    console.log(`[StreamConversation] Starting iteration=${iteration}, continuation=${continuationCount}`);

    // Auto-compress if approaching context limit
    conversation = maybeCompressConversation(conversation);

    // HARD CAP: Absolute limit even in "unlimited" mode to prevent runaway costs
    if (currentTaskToolCallCount >= HARD_TOOL_CALL_CAP) {
      console.error(`[ToolLimit] HARD CAP reached (${HARD_TOOL_CALL_CAP} tool calls). Force stopping.`);
      sendToSidebar({
        type: 'STREAM_DELTA',
        text: `\n\n⚠️ **Hard limit reached (${HARD_TOOL_CALL_CAP} tool calls).** Task force-stopped to prevent runaway costs. Please break your request into smaller parts.\n\n`
      });
      sendToSidebar({ type: 'STREAM_END' });
      return;
    }

    // Check tool call limit - if reached, ask user if they want to continue
    if (currentTaskToolCallCount >= currentTaskMaxIterations) {
      console.warn(`[ToolLimit] Reached max tool calls (${currentTaskToolCallCount}/${currentTaskMaxIterations}), asking user`);

      // Ask user if they want to continue
      const userChoice = await askUserForMoreIterations(currentTaskToolCallCount);

      if (userChoice === -1) {
        // User wants unlimited - set to hard cap (not Infinity)
        console.log(`[ToolLimit] User enabled UNLIMITED mode (capped at ${HARD_TOOL_CALL_CAP})`);
        currentTaskMaxIterations = HARD_TOOL_CALL_CAP;
        // Continue with the conversation (don't return, fall through to normal flow)
      } else if (userChoice === -2) {
        // User wants immediate stop - no summary
        console.log(`[ToolLimit] User chose immediate stop (no summary)`);
        sendToSidebar({ type: 'STREAM_END' });
        return;
      } else if (userChoice > 0) {
        // User wants to continue - update the effective limit for THIS task only
        console.log(`[ToolLimit] User allowed ${userChoice} more tool calls`);
        currentTaskMaxIterations = currentTaskToolCallCount + userChoice;
        // Continue with the conversation (don't return, fall through to normal flow)
      } else {
        // User chose to stop with summary
        console.log('[ToolLimit] User chose to stop, generating summary');

        const summaryConversation = [
          ...conversation,
          {
            role: 'user',
            content: `SYSTEM: The user has stopped the tool loop after ${currentTaskToolCallCount} tool calls. Please provide a final summary of what you accomplished and any partial results you collected. If you found some data but not all requested, share what you have.`
          }
        ];

        // Make final call WITHOUT tools to force text-only response
        try {
          const systemPrompt = await buildSystemPrompt(tabId, tabUrl);
          const stream = claudeApi.streamMessage(summaryConversation, [], systemPrompt);

          for await (const event of stream) {
            if (signal?.aborted) break;
            await handleStreamEvent(event, { tabId });
          }

          sendToSidebar({ type: 'STREAM_END' });
        } catch (error) {
          console.error('[ToolLimit] Error getting summary:', error);
          sendToSidebar({
            type: 'STREAM_DELTA',
            text: `\n\n⚠️ *Stopped after ${currentTaskToolCallCount} tool calls. Could not generate summary.*`
          });
          sendToSidebar({ type: 'STREAM_END' });
        }
        return;
      }
    }

    if (currentTaskToolCallCount > 0) {
      console.log(`[ToolCalls] Current count: ${currentTaskToolCallCount}/${currentTaskMaxIterations}`);
    }

    const systemPrompt = await buildSystemPrompt(tabId, tabUrl);

    try {
      const stream = claudeApi.streamMessage(
        conversation,
        window.BROWSER_TOOLS,
        systemPrompt
      );

      for await (const event of stream) {
        // Check for abort
        if (signal?.aborted) {
          throw new DOMException('Stream aborted', 'AbortError');
        }

        // Handle UI updates via handleStreamEvent
        await handleStreamEvent(event, { tabId });

        // Track state for tool execution
        if (event.type === 'content_block_start') {
          if (event.content_block?.type === 'text') {
            currentTextBlock = '';
          } else if (event.content_block?.type === 'tool_use') {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: {}
            };
            currentToolInputJson = '';
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            currentTextBlock += event.delta.text || '';
          } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
            // Accumulate JSON input string
            currentToolInputJson += event.delta.partial_json || '';
          }
        }

        if (event.type === 'content_block_stop') {
          if (currentTextBlock) {
            currentAssistantContent.push({
              type: 'text',
              text: currentTextBlock
            });
            currentTextBlock = '';
          }
          if (currentToolUse) {
            // Parse accumulated JSON input
            try {
              currentToolUse.input = currentToolInputJson ? JSON.parse(currentToolInputJson) : {};
            } catch (e) {
              console.warn('[StreamConversation] Failed to parse tool input JSON:', currentToolInputJson);
              currentToolUse.input = {};
            }
            currentAssistantContent.push({
              type: 'tool_use',
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: currentToolUse.input
            });
            currentToolUse = null;
            currentToolInputJson = '';
          }
        }

        // Track stop_reason and output tokens from message_delta
        if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
            console.log(`[StreamConversation] Received stop_reason: ${stopReason}`);
          }
          if (event.usage?.output_tokens) {
            outputTokensUsed = event.usage.output_tokens;
            console.log(`[StreamConversation] Output tokens used: ${outputTokensUsed}/${claudeApi.maxTokens}`);
          }
        }
      }

      // After stream ends, check if response was truncated
      const wasTruncated = stopReason === 'max_tokens';
      const hasPartialToolCall = currentToolUse !== null || currentToolInputJson.length > 0;
      const toolUses = currentAssistantContent.filter(c => c.type === 'tool_use');

      console.log(`[StreamConversation] Stream ended: stopReason=${stopReason}, outputTokens=${outputTokensUsed}, ` +
                  `truncated=${wasTruncated}, partialTool=${hasPartialToolCall}, completedTools=${toolUses.length}`);

      // Handle truncation with auto-continuation
      if (wasTruncated && continuationCount < MAX_CONTINUATIONS) {
        console.warn(`[Truncation] Response truncated at ${outputTokensUsed} tokens. ` +
                     `Partial tool in progress: ${hasPartialToolCall}. Auto-continuing (${continuationCount + 1}/${MAX_CONTINUATIONS})...`);

        // Notify sidebar about truncation
        sendToSidebar({
          type: 'STREAM_DELTA',
          text: `\n\n⚠️ *Response truncated at ${outputTokensUsed} tokens. Auto-continuing...*\n\n`
        });

        // Build continuation conversation
        // Include any partial content we got - but NEVER empty text blocks (API rejects them)
        let partialContent = currentAssistantContent.length > 0 ? [...currentAssistantContent] : [];

        // If we have text but not in content array, add it (but only if non-empty)
        if (partialContent.length === 0 && currentTextBlock && currentTextBlock.trim()) {
          partialContent = [{ type: 'text', text: currentTextBlock }];
        }

        // If still no content, use a placeholder to indicate truncation point
        if (partialContent.length === 0) {
          partialContent = [{ type: 'text', text: '[Response truncated]' }];
        }

        // Build continuation message - include partial tool call info if present
        let continuationMessage = 'Your previous response was truncated due to length limits. ';

        if (hasPartialToolCall && currentToolUse) {
          // We were in the middle of a tool call - give Claude the exact state
          continuationMessage += `You were in the middle of calling the "${currentToolUse.name}" tool. `;
          if (currentToolInputJson && currentToolInputJson.length > 0) {
            // Show the partial JSON so Claude can continue from exact position
            continuationMessage += `The partial JSON input so far was:\n\`\`\`json\n${currentToolInputJson}\n\`\`\`\n`;
            continuationMessage += `Please complete this tool call by outputting ONLY the remaining JSON (starting exactly where you left off), then close the tool call. Do not restart the tool call from the beginning.`;
          } else {
            continuationMessage += `Please complete this tool call now.`;
          }
        } else {
          continuationMessage += 'Please continue exactly where you left off.';
        }

        const continuationConversation = [
          ...conversation,
          { role: 'assistant', content: partialContent },
          { role: 'user', content: continuationMessage }
        ];

        // Recursive call with incremented continuation count
        await streamConversation(continuationConversation, tabId, tabUrl, signal, iteration, continuationCount + 1);
        return; // Exit after continuation handles completion
      }

      // Warn if truncated but max continuations reached
      if (wasTruncated && continuationCount >= MAX_CONTINUATIONS) {
        console.error(`[Truncation] Response still truncated after ${MAX_CONTINUATIONS} continuations. Giving up.`);
        sendToSidebar({
          type: 'STREAM_DELTA',
          text: `\n\n❌ *Response truncated after ${MAX_CONTINUATIONS} continuation attempts. Try breaking your request into smaller parts.*\n\n`
        });
      }

      // Normal flow: handle completed tool calls
      if (toolUses.length > 0) {
        await handleToolCalls(toolUses, conversation, currentAssistantContent, tabId, tabUrl, signal, iteration);
      } else {
        // Task complete - store in history for future reference
        if (currentTaskUserMessage) {
          const assistantText = currentAssistantContent
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
          addTaskToHistory(currentTaskUserMessage, assistantText);
          currentTaskUserMessage = null;  // Reset for next task
        }
        sendToSidebar({ type: 'STREAM_END' });
      }

    } catch (error) {
      throw error;
    }
  }

  // Handle individual stream events (UI updates only)
  async function handleStreamEvent(event, _state) {
    switch (event.type) {
      case 'message_start':
        // Send input token count with cache information
        if (event.message?.usage) {
          const usage = event.message.usage;
          sendToSidebar({
            type: 'TOKEN_USAGE',
            inputTokens: usage.input_tokens,
            // Cache metrics from Anthropic prompt caching
            cacheCreationTokens: usage.cache_creation_input_tokens || 0,
            cacheReadTokens: usage.cache_read_input_tokens || 0
          });

          // Log cache performance for debugging
          if (usage.cache_read_input_tokens > 0) {
            console.log(`[PromptCache] Cache HIT: ${usage.cache_read_input_tokens} tokens read from cache (90% savings)`);
          }
          if (usage.cache_creation_input_tokens > 0) {
            console.log(`[PromptCache] Cache WRITE: ${usage.cache_creation_input_tokens} tokens cached for future use`);
          }
        }
        break;

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          sendToSidebar({
            type: 'STREAM_TOOL_USE_START',
            toolId: event.content_block.id,
            toolName: event.content_block.name
          });
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          const text = event.delta.text;
          if (text !== undefined && text !== null) {
            sendToSidebar({
              type: 'STREAM_DELTA',
              text: text
            });
          }
        } else if (event.delta?.type === 'input_json_delta') {
          sendToSidebar({
            type: 'STREAM_TOOL_INPUT_DELTA',
            partialJson: event.delta.partial_json
          });
        }
        break;

      case 'content_block_stop':
        if (event.index !== undefined) {
          sendToSidebar({
            type: 'STREAM_BLOCK_STOP',
            index: event.index
          });
        }
        break;

      case 'message_delta':
        // Send output token count
        if (event.usage?.output_tokens) {
          sendToSidebar({
            type: 'TOKEN_USAGE',
            outputTokens: event.usage.output_tokens
          });
        }
        break;

      case 'message_stop':
        // Tool calls handled after stream ends in streamConversation
        break;

      case 'error':
        sendToSidebar({
          type: 'STREAM_ERROR',
          error: event.error?.message || 'Stream error'
        });
        break;
    }
  }

  /**
   * Summarize a tool result for context-efficient history storage
   * Full result is used for immediate response; summary is stored for history
   */
  function summarizeToolResult(toolName, input, result) {
    // Handle errors
    if (result.error) {
      return `[${toolName}] Error: ${result.error}`;
    }

    // Tool-specific summarizers
    switch (toolName) {
      case 'dom_stats':
        return `[dom_stats] Page has ${result.elementCount || '?'} elements, ` +
               `${result.depth || '?'} depth, ${result.htmlSize || '?'} bytes`;

      case 'get_page_content':
        const len = typeof result === 'string' ? result.length : JSON.stringify(result).length;
        return `[get_page_content] Retrieved ${len} chars of page HTML`;

      case 'get_dom_structure':
        const selector = input.selector || 'document';
        const nodeCount = countNodes(result);
        return `[get_dom_structure] Found ${nodeCount} nodes under '${selector}'`;

      case 'query_selector':
        const matches = Array.isArray(result) ? result.length : (result.found ? 1 : 0);
        return `[query_selector] '${input.selector}' matched ${matches} element(s)`;

      case 'execute_script':
        const resultType = typeof result;
        const preview = resultType === 'object' ?
          `${Object.keys(result || {}).length} keys` :
          String(result).slice(0, 100);
        return `[execute_script] Returned ${resultType}: ${preview}`;

      case 'click_element':
        return `[click_element] Clicked '${input.selector}'`;

      case 'type_text':
        return `[type_text] Typed ${input.text?.length || 0} chars into '${input.selector}'`;

      case 'fill_form':
        const fieldCount = Object.keys(input.fields || {}).length;
        return `[fill_form] Filled ${fieldCount} fields`;

      case 'scroll_to':
        if (input.selector) {
          return `[scroll_to] Scrolled to '${input.selector}'`;
        }
        return `[scroll_to] Scrolled to (${input.x || 0}, ${input.y || 0})`;

      case 'navigate':
        return `[navigate] Navigated to ${input.url}`;

      case 'take_screenshot':
        if (result.saved) {
          return `[take_screenshot] Saved: ${result.filename}`;
        }
        return `[take_screenshot] Captured screenshot`;

      case 'take_element_screenshot':
        return `[take_element_screenshot] Captured element: ${input.selector}`;

      case 'read_image':
        if (result.screenshot) {
          return `[read_image] Read image${input.selector ? ` from ${input.selector}` : ''}${input.url ? ` from URL` : ''}`;
        }
        return `[read_image] Failed: ${result.error || 'unknown error'}`;

      case 'create_markdown':
        return `[create_markdown] Saved: ${result.filename || 'output.md'}`;

      case 'create_html':
        return `[create_html] Saved: ${result.filename || 'report.html'}`;

      case 'save_site_spec':
        if (result.success) {
          return `[save_site_spec] Saved: "${input.description}" for current domain`;
        } else {
          return `[save_site_spec] Failed: ${result.error}`;
        }

      case 'open_download':
        return `[open_download] Opened downloaded file: ${result.filename || 'unknown'}`;

      case 'get_cookies':
        const cookieCount = Array.isArray(result.cookies) ? result.cookies.length : 0;
        return `[get_cookies] Found ${cookieCount} cookies`;

      case 'get_local_storage':
      case 'get_session_storage':
        const storageKeys = Object.keys(result || {}).length;
        return `[${toolName}] Found ${storageKeys} storage entries`;

      case 'wait_for_element':
        return `[wait_for_element] Element '${input.selector}' ${result.found ? 'found' : 'not found'}`;

      case 'fetch_url':
        if (result.error) {
          return `[fetch_url] Failed to fetch ${input.url}: ${result.error}`;
        }
        return `[fetch_url] Fetched "${result.title || input.url}" (${result.contentLength} chars${result.truncated ? ', truncated' : ''})`;

      default:
        // Generic summary
        const resultStr = JSON.stringify(result);
        if (resultStr.length > 200) {
          return `[${toolName}] Completed (${resultStr.length} chars of data)`;
        }
        return `[${toolName}] ${resultStr.slice(0, 200)}`;
    }
  }

  // Helper to count nodes in DOM structure result
  function countNodes(obj, count = 0) {
    if (!obj || typeof obj !== 'object') return count;
    count++;
    if (obj.children && Array.isArray(obj.children)) {
      for (const child of obj.children) {
        count = countNodes(child, count);
      }
    }
    return count;
  }

  /**
   * Rough token estimation for a conversation
   * Uses ~4 chars per token heuristic
   * @param {Array} conversation - The conversation array
   * @returns {number} Estimated token count
   */
  function estimateConversationTokens(conversation) {
    let totalChars = 0;

    for (const msg of conversation) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            totalChars += block.text.length;
          } else if (block.type === 'tool_use') {
            totalChars += JSON.stringify(block.input || {}).length + 50; // tool overhead
          } else if (block.type === 'tool_result') {
            const content = block.content;
            if (typeof content === 'string') {
              totalChars += content.length;
            } else if (Array.isArray(content)) {
              // Image or complex content
              totalChars += 1000; // Rough estimate for images
            }
          }
        }
      }
    }

    return Math.ceil(totalChars / 4);
  }

  // Context limits
  const MAX_CONTEXT_TOKENS = 200000; // Claude's context window
  const COMPRESSION_THRESHOLD = 0.80; // Compress at 80%
  const KEEP_RECENT_TURNS = 4; // Always keep last N turns intact

  /**
   * Compress conversation history by replacing verbose tool results with summaries
   * This preserves the conversation flow while reducing context size
   */
  function compressConversationHistory(conversation) {
    return conversation.map(msg => {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        // Check if this is a tool_result message
        const hasToolResults = msg.content.some(c => c.type === 'tool_result');
        if (hasToolResults) {
          return {
            ...msg,
            content: msg.content.map(c => {
              if (c.type === 'tool_result') {
                // Compress tool result content if it's large
                let content = c.content;
                if (typeof content === 'string' && content.length > 500) {
                  // Already verbose - try to extract key info or truncate
                  content = `[Previous result: ${content.slice(0, 200)}...]`;
                } else if (Array.isArray(content)) {
                  // Image content - keep reference but not data
                  const hasImage = content.some(item => item.type === 'image');
                  if (hasImage) {
                    content = '[Previous result: screenshot captured]';
                  }
                }
                return { ...c, content };
              }
              return c;
            })
          };
        }
      }
      return msg;
    });
  }

  /**
   * Aggressively compress old conversation turns
   * Keeps recent turns intact, summarizes/truncates older ones
   * @param {Array} conversation - The conversation array
   * @param {number} keepRecentTurns - Number of recent turns to keep intact
   * @returns {Array} Compressed conversation
   */
  function aggressivelyCompressConversation(conversation, keepRecentTurns = KEEP_RECENT_TURNS) {
    if (conversation.length <= keepRecentTurns * 2) {
      // Not enough to compress - just use basic compression
      return compressConversationHistory(conversation);
    }

    const compressed = [];
    const recentStartIndex = conversation.length - (keepRecentTurns * 2);

    // Collect summaries of old turns
    let oldTurnSummaries = [];

    for (let i = 0; i < recentStartIndex; i++) {
      const msg = conversation[i];

      if (msg.role === 'user') {
        // Extract user intent
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.find(c => c.type === 'text')?.text || '[tool results]';

        // Truncate long user messages
        const summary = content.length > 100
          ? content.slice(0, 100) + '...'
          : content;

        if (!summary.startsWith('[tool')) {
          oldTurnSummaries.push(`User: ${summary}`);
        }
      } else if (msg.role === 'assistant') {
        // Extract key assistant action/response
        let summary = '';
        const content = msg.content;

        if (typeof content === 'string') {
          summary = content.slice(0, 100);
        } else if (Array.isArray(content)) {
          // Look for answer tags or tool uses
          const textBlock = content.find(c => c.type === 'text');
          const toolUses = content.filter(c => c.type === 'tool_use');

          if (toolUses.length > 0) {
            summary = `[Used: ${toolUses.map(t => t.name).join(', ')}]`;
          } else if (textBlock?.text) {
            // Extract answer if present
            const answerMatch = textBlock.text.match(/<answer>([\s\S]*?)<\/answer>/);
            if (answerMatch) {
              summary = answerMatch[1].slice(0, 100);
            } else {
              summary = textBlock.text.slice(0, 100);
            }
          }
        }

        if (summary) {
          oldTurnSummaries.push(`Assistant: ${summary}${summary.length >= 100 ? '...' : ''}`);
        }
      }
    }

    // Add compressed history as a single system-like context message
    if (oldTurnSummaries.length > 0) {
      compressed.push({
        role: 'user',
        content: `[COMPRESSED CONVERSATION HISTORY - ${oldTurnSummaries.length} earlier exchanges]\n${oldTurnSummaries.join('\n')}\n[END COMPRESSED HISTORY]`
      });
      compressed.push({
        role: 'assistant',
        content: 'I understand the conversation history. Continuing from where we left off.'
      });
    }

    // Add recent turns intact (but still compress large tool results)
    for (let i = recentStartIndex; i < conversation.length; i++) {
      const msg = conversation[i];

      // Still compress large tool results in recent turns
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const hasLargeToolResult = msg.content.some(c =>
          c.type === 'tool_result' &&
          typeof c.content === 'string' &&
          c.content.length > 2000
        );

        if (hasLargeToolResult) {
          compressed.push({
            ...msg,
            content: msg.content.map(c => {
              if (c.type === 'tool_result' && typeof c.content === 'string' && c.content.length > 2000) {
                return { ...c, content: c.content.slice(0, 2000) + '\n[... truncated ...]' };
              }
              return c;
            })
          });
          continue;
        }
      }

      compressed.push(msg);
    }

    console.log(`[ContextCompression] Compressed ${conversation.length} messages to ${compressed.length} (kept ${keepRecentTurns} recent turns)`);

    return compressed;
  }

  /**
   * Check if conversation needs compression and compress if necessary
   * @param {Array} conversation - The conversation array
   * @returns {Array} Original or compressed conversation
   */
  function maybeCompressConversation(conversation) {
    const estimatedTokens = estimateConversationTokens(conversation);
    const threshold = MAX_CONTEXT_TOKENS * COMPRESSION_THRESHOLD;

    console.log(`[ContextCompression] Estimated tokens: ${estimatedTokens}, threshold: ${threshold}`);

    if (estimatedTokens > threshold) {
      console.log(`[ContextCompression] Triggering compression (${estimatedTokens} > ${threshold})`);
      return aggressivelyCompressConversation(conversation);
    }

    return conversation;
  }

  /**
   * Strip working notes from assistant content for history
   * Removes <work>...</work> tags, keeps only final answer and tool_use blocks
   */
  function compressAssistantContent(content) {
    if (!Array.isArray(content)) return content;

    return content.map(block => {
      if (block.type === 'text' && block.text) {
        // Strip <work>...</work> tags (working notes) - keep only final answer
        const stripped = block.text.replace(/<work>[\s\S]*?<\/work>/gi, '').trim();
        if (stripped) {
          return { ...block, text: stripped };
        } else if (block.text.length > 500) {
          // No final answer found, truncate the working notes
          return { ...block, text: block.text.slice(0, 200) + '...' };
        }
      }
      return block;
    });
  }


  // Handle tool calls from Claude
  async function handleToolCalls(toolUses, conversation, assistantContent, tabId, tabUrl, signal, iteration = 0) {
    const toolResults = [];
    const toolSummaries = []; // For history storage

    for (const toolUse of toolUses) {
      if (signal?.aborted) break;

      const { id, name, input } = toolUse;

      // In 'ask' mode (default), high-risk tools require confirmation.
      // In 'auto' mode (skip all), nothing requires confirmation.
      const needsConfirmation = getAutonomyMode(tabId) === 'ask' && configuredHighRiskTools.includes(name);

      if (needsConfirmation) {
        // Request confirmation BEFORE showing tool in UI
        const approved = await requestToolConfirmation(id, name, input);

        if (!approved) {
          // Show cancelled tool in UI
          sendToSidebar({
            type: 'STREAM_TOOL_USE',
            toolId: id,
            toolName: name,
            toolInput: input
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: 'User cancelled this action.'
          });
          sendToSidebar({
            type: 'TOOL_RESULT',
            toolId: id,
            result: { cancelled: true }
          });
          continue;
        }
      }

      // Show tool in UI only after confirmation granted (or if no confirmation needed)
      sendToSidebar({
        type: 'STREAM_TOOL_USE',
        toolId: id,
        toolName: name,
        toolInput: input
      });

      // Increment tool call counter
      currentTaskToolCallCount++;
      console.log(`[ToolCalls] Incrementing count to ${currentTaskToolCallCount}`);

      // Execute the tool
      try {
        console.log(`Executing tool: ${name}`, input);
        const result = await window.executeTool(name, input);
        console.log(`Tool result (${name}):`, result);

        // Feed to passive interaction observer
        if (window.InteractionObserver && tabUrl) {
          try {
            const domain = new URL(tabUrl).hostname.replace(/^www\./, '');
            window.InteractionObserver.processToolResult(name, input, result, domain);
          } catch (e) {
            // Silently ignore - observer is non-critical
          }
        }

        // Create summary for history storage
        const summary = summarizeToolResult(name, input, result);
        toolSummaries.push({ id, name, input, summary });

        // Handle image results specially - use image content block for Claude vision
        if (result.screenshot) {
          try {
            // Extract media type and base64 data from data URL
            const dataUrlMatch = result.screenshot.match(/^data:(image\/\w+);base64,(.+)$/);
            if (!dataUrlMatch) {
              throw new Error('Invalid screenshot data URL format');
            }

            const mediaType = dataUrlMatch[1]; // e.g., 'image/png' or 'image/jpeg'
            const base64Data = dataUrlMatch[2];

            // Validate base64 data is not empty and reasonably sized
            if (!base64Data || base64Data.length < 100) {
              throw new Error('Screenshot data appears empty or corrupted');
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: id,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Data
                  }
                }
              ]
            });
          } catch (screenshotError) {
            console.error('Screenshot processing error:', screenshotError);
            // Fall back to text result on error
            toolResults.push({
              type: 'tool_result',
              tool_use_id: id,
              content: `Screenshot captured but failed to process: ${screenshotError.message}. Try again or use a different approach.`
            });
          }
        } else {
          // For other tools, stringify the result but truncate if too large
          let resultStr = JSON.stringify(result);
          if (resultStr.length > 50000) {
            console.warn(`Tool result too large (${resultStr.length} chars), truncating`);
            resultStr = resultStr.slice(0, 50000) + '\n... [TRUNCATED - result too large]';
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: resultStr
          });
        }

        sendToSidebar({
          type: 'TOOL_RESULT',
          toolId: id,
          result: result
        });

      } catch (error) {
        console.error(`Tool execution error (${name}):`, error);

        const errorSummary = summarizeToolResult(name, input, { error: error.message });
        toolSummaries.push({ id, name, input, summary: errorSummary });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify({ error: error.message }),
          is_error: true
        });

        sendToSidebar({
          type: 'TOOL_RESULT',
          toolId: id,
          result: { error: error.message },
          isError: true
        });
      }
    }

    // If there were tool results, continue the conversation
    if (toolResults.length > 0 && !signal?.aborted) {
      // Compress prior conversation: replace verbose tool results with summaries
      // Then check if we need aggressive compression due to approaching context limit
      const compressedConversation = maybeCompressConversation(compressConversationHistory(conversation));

      // Strip working notes from assistant content for history
      const compressedAssistantContent = compressAssistantContent(assistantContent);

      // Add assistant message with compressed content
      const assistantMessage = {
        role: 'assistant',
        content: compressedAssistantContent
      };

      // Add user message with FULL tool results (needed for current turn)
      const toolResultMessage = {
        role: 'user',
        content: toolResults
      };

      let updatedConversation = [
        ...compressedConversation,
        assistantMessage,
        toolResultMessage
      ];

      // Continue streaming with updated conversation, with error recovery
      // Pass iteration + 1 to track tool call depth
      try {
        await streamConversation(updatedConversation, tabId, tabUrl, signal, iteration + 1);
      } catch (error) {
        // Check if this is a token overflow error
        const isTokenOverflow = error.message?.includes('too long') ||
                               error.message?.includes('maximum') ||
                               error.message?.includes('tokens');

        if (isTokenOverflow && !signal?.aborted) {
          console.warn('Token overflow detected, feeding error back to Claude');

          // Replace large tool results with error messages
          const truncatedResults = toolResults.map(result => {
            const contentStr = typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content);

            if (contentStr.length > 1000) {
              return {
                ...result,
                content: `Error: Tool result was too large (${Math.round(contentStr.length / 1024)}KB) and caused context overflow. The data was not included. Please try a different approach - use more targeted queries, smaller data extractions, or avoid screenshots for element location.`,
                is_error: true
              };
            }
            return result;
          });

          // Rebuild conversation with truncated results
          const recoveryConversation = [
            ...conversation,
            assistantMessage,
            { role: 'user', content: truncatedResults }
          ];

          // Retry with truncated results (same iteration count - this is error recovery, not progression)
          try {
            await streamConversation(recoveryConversation, tabId, tabUrl, signal, iteration);
          } catch (retryError) {
            // If still failing, propagate the error
            throw retryError;
          }
        } else if (error.message?.includes('Network error') && !signal?.aborted) {
          // Network error - notify Claude and let it retry or proceed differently
          console.warn('Network error during streaming, feeding back to Claude for recovery');

          const networkErrorResults = [{
            type: 'tool_result',
            tool_use_id: toolUses[toolUses.length - 1]?.id || 'unknown',
            content: `Network error occurred: ${error.message}. The previous action may not have completed. Please acknowledge this error and either retry the action or proceed with an alternative approach.`,
            is_error: true
          }];

          const recoveryConversation = [
            ...conversation,
            assistantMessage,
            { role: 'user', content: networkErrorResults }
          ];

          try {
            await streamConversation(recoveryConversation, tabId, tabUrl, signal, iteration);
          } catch (retryError) {
            // If still failing, send error to sidebar and end gracefully
            console.error('Recovery failed:', retryError);
            sendToSidebar({ type: 'STREAM_ERROR', error: retryError.message || 'Network error - please try again' });
          }
        } else {
          // Other error or aborted, propagate
          throw error;
        }
      }
    } else {
      // No tool calls or aborted - end the stream
      sendToSidebar({ type: 'STREAM_END' });
    }
  }

  // Request confirmation from user for high-risk tool
  function requestToolConfirmation(toolId, toolName, toolInput) {
    return new Promise((resolve) => {
      pendingToolConfirmations.set(toolId, resolve);

      sendToSidebar({
        type: 'CONFIRM_TOOL',
        toolId: toolId,
        toolName: toolName,
        toolInput: toolInput
      });
    });
  }

  // Handle tool confirmation response from sidebar
  function handleToolConfirmation(payload) {
    const { toolId, approved } = payload;
    const resolver = pendingToolConfirmations.get(toolId);

    if (resolver) {
      resolver(approved);
      pendingToolConfirmations.delete(toolId);
    }
  }

  // Ask user if they want to allow more iterations
  function askUserForMoreIterations(currentIteration) {
    return new Promise((resolve) => {
      const promptId = Date.now().toString();
      pendingIterationPrompts.set(promptId, resolve);

      sendToSidebar({
        type: 'ITERATION_LIMIT_REACHED',
        promptId: promptId,
        currentIteration: currentIteration
      });
    });
  }

  // Handle user's response to iteration limit prompt
  function handleIterationLimitResponse(payload) {
    const { promptId, allowMore } = payload;
    const resolver = pendingIterationPrompts.get(promptId);

    if (resolver) {
      resolver(allowMore); // Number of iterations, 0=stop+summary, -1=unlimited, -2=stop immediately
      pendingIterationPrompts.delete(promptId);
    }
  }

  // Handle screenshot request
  async function handleTakeScreenshot() {
    try {
      // Use JPEG with 80% quality for smaller file size (PNG can be 500KB+, JPEG is ~100KB)
      const dataUrl = await browser.tabs.captureVisibleTab(null, {
        format: 'jpeg',
        quality: 80
      });
      console.log(`[Screenshot] Captured ${Math.round(dataUrl.length / 1024)}KB`);
      return { success: true, screenshot: dataUrl };
    } catch (error) {
      console.error('Screenshot error:', error);
      return { success: false, error: error.message };
    }
  }

  // Handle stream cancellation
  function handleCancelStream(tabId) {
    const controller = activeStreams.get(tabId);
    if (controller) {
      controller.abort();
      activeStreams.delete(tabId);
    }
  }

  // Build system prompt with current page context and site knowledge
  // Returns structured array format for Anthropic prompt caching
  async function buildSystemPrompt(tabId, tabUrl) {
    // Build dynamic context (site-specific, changes per domain)
    let dynamicContext = '';

    // Add site knowledge for current domain if available
    if (tabUrl && window.SiteKnowledge) {
      const domain = window.SiteKnowledge.extractDomain(tabUrl);
      if (domain) {
        try {
          const path = new URL(tabUrl).pathname;
          console.log(`[SiteKnowledge] Looking for knowledge: domain=${domain}, path=${path}`);

          // Check for raw markdown first (user-edited takes priority)
          const rawKnowledge = await window.SiteKnowledge.getRaw(domain);
          if (rawKnowledge) {
            // Raw knowledge is already formatted markdown - inject with clear header
            dynamicContext += `\n\n╔══════════════════════════════════════════════════════════════╗
║  SITE KNOWLEDGE FOR: ${domain.padEnd(41)}║
╚══════════════════════════════════════════════════════════════╝

${rawKnowledge}

═══════════════════════════════════════════════════════════════`;
            console.log(`[SiteKnowledge] Injected raw knowledge (${rawKnowledge.length} chars) for ${domain}`);
          } else {
            // Get structured knowledge for this path (includes global knowledge)
            const knowledge = await window.SiteKnowledge.getForPath(domain, path);
            console.log(`[SiteKnowledge] Found ${knowledge.length} knowledge items`);
            if (knowledge.length > 0) {
              const knowledgeText = window.SiteKnowledge.formatForPrompt(knowledge, domain);
              dynamicContext += knowledgeText;
              console.log(`[SiteKnowledge] Injected knowledge:\n${knowledgeText.slice(0, 500)}...`);
            }
          }
        } catch (error) {
          console.error('Error loading site knowledge:', error);
        }
      }
    }

    // Add observed API patterns for current domain
    if (tabUrl && window.ApiObserver) {
      try {
        const domain = new URL(tabUrl).hostname.replace(/^www\./, '');
        const apiPatterns = window.ApiObserver.formatForPrompt(domain);
        if (apiPatterns) {
          dynamicContext += apiPatterns;
          console.log(`[ApiObserver] Injected patterns for ${domain}`);
        }
      } catch (e) {
        console.warn('[ApiObserver] Format error:', e);
      }
    }

    // Add observed DOM interaction patterns for current domain
    if (tabUrl && window.InteractionObserver) {
      try {
        const domain = new URL(tabUrl).hostname.replace(/^www\./, '');
        const domPatterns = window.InteractionObserver.formatForPrompt(domain);
        if (domPatterns) {
          dynamicContext += domPatterns;
          console.log(`[InteractionObserver] Injected patterns for ${domain}`);
        }
      } catch (e) {
        console.warn('[InteractionObserver] Format error:', e);
      }
    }

    // Add current autonomy mode info (per-tab setting)
    if (getAutonomyMode(tabId) === 'auto') {
      dynamicContext += '\n\nMode: AUTO - Tools execute immediately.';
    } else {
      dynamicContext += '\n\nMode: CONFIRM - User sees confirmation dialog before tool execution.';
    }

    // Return structured array for prompt caching
    // Static base prompt is cached (large, never changes)
    // Dynamic context is cached (stable per domain within tab session)
    const basePrompt = getSystemPrompt();
    const systemBlocks = [
      {
        type: 'text',
        text: basePrompt,
        cache_control: { type: 'ephemeral' }  // Cache the static base prompt (~4-5k tokens)
      }
    ];

    // Add dynamic context as separate block (cached - stable per domain within tab session)
    if (dynamicContext.trim()) {
      systemBlocks.push({
        type: 'text',
        text: dynamicContext,
        cache_control: { type: 'ephemeral' }
      });
    }

    console.log(`[PromptCache] Built system prompt: ${systemBlocks.length} blocks, static=${basePrompt.length} chars, dynamic=${dynamicContext.length} chars`);

    return systemBlocks;
  }

  // Send message to sidebar (targeted to specific window if windowId is set)
  function sendToSidebar(message) {
    // Include window ID for multi-window support
    const targetedMessage = currentStreamWindowId
      ? { ...message, windowId: currentStreamWindowId }
      : message;

    browser.runtime.sendMessage(targetedMessage).catch(err => {
      // Sidebar might be closed, ignore
      if (!err.message?.includes('Receiving end does not exist')) {
        console.warn('Failed to send to sidebar:', err);
      }
    });
  }

  // ========== Site Knowledge System Handlers (Unified API) ==========

  // Get knowledge for a domain (backward compat: returns { experiences } or { specs })
  async function handleGetKnowledge(payload) {
    const { domain } = payload;
    if (!domain) return { experiences: [], specs: [] };

    try {
      if (window.SiteKnowledge) {
        // Get domain-specific knowledge
        const domainKnowledge = await window.SiteKnowledge.get(domain);

        // Also get global knowledge (domain: "*") if not already fetching for "*"
        let globalKnowledge = [];
        if (domain !== '*') {
          globalKnowledge = await window.SiteKnowledge.get('*');
        }

        // Merge: domain-specific first, then global
        const allKnowledge = [...domainKnowledge, ...globalKnowledge];

        // Return in both formats for backward compat
        return { experiences: allKnowledge, specs: allKnowledge };
      }
      return { experiences: [], specs: [] };
    } catch (error) {
      console.error('[SiteKnowledge] Error getting knowledge:', error);
      return { experiences: [], specs: [], error: error.message };
    }
  }

  // Add new knowledge (backward compat: accepts experience or spec object)
  async function handleAddKnowledge(payload) {
    const { domain, experience, spec } = payload;
    const knowledge = experience || spec;
    if (!domain || !knowledge) {
      return { success: false, error: 'Missing domain or knowledge' };
    }

    try {
      if (window.SiteKnowledge) {
        const saved = await window.SiteKnowledge.add(domain, knowledge);
        return { success: !!saved, experience: saved, spec: saved };
      }
      return { success: false, error: 'SiteKnowledge not available' };
    } catch (error) {
      console.error('[SiteKnowledge] Error adding knowledge:', error);
      return { success: false, error: error.message };
    }
  }

  // Get knowledge count for a domain (includes global)
  async function handleGetKnowledgeCount(payload) {
    const { domain } = payload;
    if (!domain) return { count: 0 };

    try {
      if (window.SiteKnowledge) {
        const domainCount = await window.SiteKnowledge.getCount(domain);
        // Also count global knowledge if not already counting for "*"
        let globalCount = 0;
        if (domain !== '*') {
          globalCount = await window.SiteKnowledge.getCount('*');
        }
        return { count: domainCount + globalCount };
      }
      return { count: 0 };
    } catch (error) {
      console.error('[SiteKnowledge] Error getting knowledge count:', error);
      return { count: 0, error: error.message };
    }
  }

  // Clear all knowledge for a domain
  async function handleClearKnowledge(payload) {
    const { domain } = payload;
    if (!domain) return { success: false, error: 'Missing domain' };

    try {
      if (window.SiteKnowledge) {
        await window.SiteKnowledge.clear(domain);
        return { success: true };
      }
      return { success: false, error: 'SiteKnowledge not available' };
    } catch (error) {
      console.error('[SiteKnowledge] Error clearing knowledge:', error);
      return { success: false, error: error.message };
    }
  }

  // Update existing knowledge
  async function handleUpdateKnowledge(payload) {
    const { domain, specId, updates } = payload;
    if (!domain || !specId || !updates) {
      return { success: false, error: 'Missing domain, specId, or updates' };
    }

    try {
      if (window.SiteKnowledge) {
        const updated = await window.SiteKnowledge.update(domain, specId, updates);
        return { success: !!updated, spec: updated };
      }
      return { success: false, error: 'SiteKnowledge not available' };
    } catch (error) {
      console.error('[SiteKnowledge] Error updating knowledge:', error);
      return { success: false, error: error.message };
    }
  }

  // Delete a knowledge item
  async function handleDeleteKnowledge(payload) {
    const { domain, specId } = payload;
    if (!domain || !specId) {
      return { success: false, error: 'Missing domain or specId' };
    }

    try {
      if (window.SiteKnowledge) {
        const deleted = await window.SiteKnowledge.delete(domain, specId);
        return { success: deleted };
      }
      return { success: false, error: 'SiteKnowledge not available' };
    } catch (error) {
      console.error('[SiteKnowledge] Error deleting knowledge:', error);
      return { success: false, error: error.message };
    }
  }

  // Set raw markdown knowledge for a domain
  async function handleSetRawKnowledge(payload) {
    const { domain, content } = payload;
    if (!domain) {
      return { success: false, error: 'Missing domain' };
    }

    try {
      if (window.SiteKnowledge) {
        await window.SiteKnowledge.setRaw(domain, content);
        return { success: true };
      }
      return { success: false, error: 'SiteKnowledge not available' };
    } catch (error) {
      console.error('[SiteKnowledge] Error setting raw knowledge:', error);
      return { success: false, error: error.message };
    }
  }

  // Get raw markdown knowledge for a domain
  async function handleGetRawKnowledge(payload) {
    const { domain } = payload;
    if (!domain) {
      return { content: null };
    }

    try {
      if (window.SiteKnowledge) {
        const content = await window.SiteKnowledge.getRaw(domain);
        return { content };
      }
      return { content: null };
    } catch (error) {
      console.error('[SiteKnowledge] Error getting raw knowledge:', error);
      return { content: null, error: error.message };
    }
  }

  // Get NEW knowledge count (since last review, includes global)
  async function handleGetNewKnowledgeCount(payload) {
    const { domain } = payload;
    if (!domain) return { count: 0 };

    try {
      if (window.SiteKnowledge) {
        const domainCount = await window.SiteKnowledge.getNewCount(domain);
        // Also count new global knowledge
        let globalCount = 0;
        if (domain !== '*') {
          globalCount = await window.SiteKnowledge.getNewCount('*');
        }
        return { count: domainCount + globalCount };
      }
      return { count: 0 };
    } catch (error) {
      console.error('[SiteKnowledge] Error getting new knowledge count:', error);
      return { count: 0, error: error.message };
    }
  }

  // Set knowledge as reviewed for a domain
  async function handleSetKnowledgeReviewed(payload) {
    const { domain } = payload;
    if (!domain) return { success: false, error: 'Missing domain' };

    try {
      if (window.SiteKnowledge) {
        await window.SiteKnowledge.setLastReviewed(domain);
        return { success: true };
      }
      return { success: false, error: 'SiteKnowledge not available' };
    } catch (error) {
      console.error('[SiteKnowledge] Error setting knowledge reviewed:', error);
      return { success: false, error: error.message };
    }
  }

  // Get current tab URL
  async function handleGetCurrentTabUrl() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return { url: tab?.url || null };
    } catch (error) {
      console.error('Error getting current tab URL:', error);
      return { url: null, error: error.message };
    }
  }

  // Export full context for debugging analysis
  async function handleExportContext(payload) {
    const { conversation, model, tabId, tabUrl } = payload;

    try {
      // Build the system prompt exactly as it would be sent
      const systemPrompt = await buildSystemPrompt(tabId, tabUrl);

      // Build tools array with cache_control (exactly as sent to API)
      const tools = window.BROWSER_TOOLS.map((tool, index) => {
        if (index === window.BROWSER_TOOLS.length - 1) {
          return { ...tool, cache_control: { type: 'ephemeral' } };
        }
        return tool;
      });

      // Build the full request body as it would be sent to Anthropic
      const requestBody = {
        model: model || claudeApi?.model || 'claude-haiku-4-5',
        max_tokens: claudeApi?.maxTokens || 8192,
        temperature: claudeApi?.temperature || 0,
        system: systemPrompt,
        messages: conversation,
        tools: tools,
        stream: true
      };

      // Return the context for export
      return {
        context: {
          requestBody: requestBody,
          // Also include separate parts for easier analysis
          systemPromptBlocks: systemPrompt,
          conversationMessages: conversation,
          toolDefinitions: tools,
          meta: {
            autonomyMode: getAutonomyMode(tabId),
            apiConfigured: !!claudeApi,
            toolCount: tools.length
          }
        }
      };
    } catch (error) {
      console.error('Error building export context:', error);
      return { error: error.message };
    }
  }

  // Summarize conversation context for compression
  async function handleSummarizeContext(payload) {
    const { text } = payload;

    if (!claudeApi) {
      return { summary: 'Previous conversation about browser automation.' };
    }

    try {
      console.log('[ContextManager] Requesting summary from Claude...');

      // Use a minimal, fast call to summarize
      const response = await claudeApi.sendMessage([
        {
          role: 'user',
          content: text
        }
      ], []); // No tools needed for summarization

      // Extract text from response
      let summary = 'Previous conversation about browser automation tasks.';
      if (response.content) {
        for (const block of response.content) {
          if (block.type === 'text') {
            summary = block.text;
            break;
          }
        }
      }

      console.log('[ContextManager] Summary generated:', summary.slice(0, 100) + '...');
      return { summary };

    } catch (error) {
      console.error('[ContextManager] Summarization failed:', error);
      return { summary: 'Previous conversation about browser automation tasks.' };
    }
  }

  // Export for debugging
  window.claudeAssistantDebug = {
    getState: () => ({
      hasApi: !!claudeApi,
      defaultAutonomyMode,
      debugMode,
      tabAutonomyModes: Object.fromEntries(tabAutonomyModes),
      activeStreams: activeStreams.size,
      pendingConfirmations: pendingToolConfirmations.size,
      taskHistoryCount: taskHistory.length
    }),
    reloadSettings: loadSettings,
    // Toggle debug mode (logs full API requests)
    toggleDebug: async (on) => {
      const newValue = on !== undefined ? on : !debugMode;
      await browser.storage.local.set({ debugMode: newValue });
      return `Debug mode: ${newValue ? 'ON' : 'OFF'}`;
    },
    // View task history
    getTaskHistory: () => taskHistory
  };

})();
