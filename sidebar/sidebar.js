/**
 * Foxhole for Claude - Sidebar UI
 * Main coordinator that wires together modular components.
 * Handles state management, settings, and event listener setup.
 */

(function() {
  'use strict';

  // ============================================================================
  // STATE
  // ============================================================================

  /** @type {Array} Conversation messages */
  let conversation = [];

  /** @type {boolean} Whether streaming is in progress */
  let isStreaming = false;

  /** @type {number|null} Tab ID associated with current stream */
  let streamingTabId = null;

  /** @type {number|null} Tab to switch to after streaming completes */
  let pendingTabSwitch = null;

  /** @type {string} Current autonomy mode ('ask' or 'auto') */
  let autonomyMode = 'ask';

  /** @type {string} Selected model ID */
  let selectedModel = 'claude-haiku-4-5';

  /** @type {boolean} Whether API key is configured */
  let apiKeyConfigured = false;

  /** @type {Object} Token usage tracking - cumulative for session */
  let tokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

  /** @type {Object} Token usage for last turn only */
  let lastTurnTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

  /** @type {string[]} Tools that require confirmation in 'ask' mode */
  let configuredHighRiskTools = ['click_element', 'type_text', 'navigate', 'execute_script', 'fill_form', 'press_key'];

  /** @type {Array} Pending images to send with next message */
  let pendingImages = [];

  /** @type {Array} Tool names used during current streaming response (for conversation history) */
  let currentStreamingTools = [];

  /** @type {Object|null} Thinking timer state */
  let thinkingTimer = null;

  /** @type {number|null} Currently active tab ID */
  let currentTabId = null;

  /** @type {number|null} Current window ID for message filtering */
  let currentWindowId = null;

  /** @type {Map<number, Object>} Per-tab conversation state */
  const tabConversations = new Map();

  // ============================================================================
  // DOM ELEMENTS
  // ============================================================================

  const chatContainer = document.getElementById('chat-container');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const modelSelect = document.getElementById('model-select');
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const menuBtn = document.getElementById('menu-btn');
  const dropdownMenu = document.getElementById('dropdown-menu');
  const autonomyBtn = document.getElementById('autonomy-btn');
  const autonomyMenu = document.getElementById('autonomy-menu');
  const autonomyLabel = document.getElementById('autonomy-label');
  const autonomyOptions = document.querySelectorAll('.autonomy-option');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const imagePreviewContainer = document.getElementById('image-preview-container');
  // imagePreview and removeImageBtn are now created dynamically per-image in renderImagePreviews()
  const settingsMenuBtn = document.getElementById('settings-menu-btn');
  const exportContextBtn = document.getElementById('export-context-btn');

  // Modal Elements
  const confirmModal = document.getElementById('confirm-modal');
  const confirmAction = document.getElementById('confirm-action');
  const confirmParams = document.getElementById('confirm-params');
  const confirmCancel = document.getElementById('confirm-cancel');
  const confirmApprove = document.getElementById('confirm-approve');
  const apiKeyModal = document.getElementById('api-key-modal');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiKeySave = document.getElementById('api-key-save');
  const clearConfirmModal = document.getElementById('clear-confirm-modal');
  const clearConfirmCancel = document.getElementById('clear-confirm-cancel');
  const clearConfirmApprove = document.getElementById('clear-confirm-approve');
  // Notes Modal Elements
  const notesBtn = document.getElementById('notes-btn');
  const notesBadge = document.getElementById('notes-badge');
  const notesModal = document.getElementById('notes-modal');
  const notesClose = document.getElementById('notes-close');
  const notesDone = document.getElementById('notes-done');
  const notesDomain = document.getElementById('notes-domain');
  const notesRendered = document.getElementById('notes-rendered');
  const notesSource = document.getElementById('notes-source');
  const notesMarkdown = document.getElementById('notes-markdown');
  const notesEmpty = document.getElementById('notes-empty');
  const notesCount = document.getElementById('notes-count');
  const notesViewRendered = document.getElementById('notes-view-rendered');
  const notesViewSource = document.getElementById('notes-view-source');
  const notesClearAll = document.getElementById('notes-clear-all');
  const attachMenu = document.getElementById('attach-menu');

  // ============================================================================
  // MODULE INSTANCES
  // ============================================================================

  /** @type {Object|null} SpecsManager instance */
  let specsManager = null;


  // ============================================================================
  // STATE ACCESSORS (for modules)
  // ============================================================================

  function getState() {
    return {
      conversation,
      isStreaming,
      streamingTabId,
      pendingTabSwitch,
      autonomyMode,
      selectedModel,
      apiKeyConfigured,
      tokenUsage,
      lastTurnTokens,
      configuredHighRiskTools,
      pendingImages,
      currentTabId,
      currentWindowId,
      tabConversations
    };
  }

  function setState(updates) {
    if ('conversation' in updates) conversation = updates.conversation;
    if ('isStreaming' in updates) isStreaming = updates.isStreaming;
    if ('streamingTabId' in updates) streamingTabId = updates.streamingTabId;
    if ('pendingTabSwitch' in updates) pendingTabSwitch = updates.pendingTabSwitch;
    if ('autonomyMode' in updates) autonomyMode = updates.autonomyMode;
    if ('selectedModel' in updates) selectedModel = updates.selectedModel;
    if ('apiKeyConfigured' in updates) apiKeyConfigured = updates.apiKeyConfigured;
    if ('tokenUsage' in updates) tokenUsage = updates.tokenUsage;
    if ('lastTurnTokens' in updates) lastTurnTokens = updates.lastTurnTokens;
    if ('pendingImages' in updates) pendingImages = updates.pendingImages;
    if ('currentTabId' in updates) currentTabId = updates.currentTabId;
    if ('currentWindowId' in updates) currentWindowId = updates.currentWindowId;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async function init() {
    await loadSettings();
    await checkApiKey();

    // Initialize SpecsManager
    specsManager = window.SpecsManager.createSpecsManager(
      {
        notesModal,
        notesDomain,
        notesRendered,
        notesSource,
        notesMarkdown,
        notesEmpty,
        notesCount,
        notesViewRendered,
        notesViewSource,
        notesBadge
      },
      (msg) => browser.runtime.sendMessage(msg)
    );

    // Initialize ModalManager
    window.ModalManager.init({
      elements: {
        clearConfirmModal,
        confirmModal,
        confirmAction,
        confirmParams,
        confirmCancel,
        confirmApprove,
        apiKeyModal,
        apiKeyInput,
        dropdownMenu,
        menuBtn,
        autonomyMenu,
        autonomyBtn,
        autonomyLabel,
        autonomyOptions,
        chatContainer,
        userInput,
        imagePreviewContainer,
        attachMenu
      },
      callbacks: {
        getState,
        setState,
        scrollToBottom: () => window.RenderUtils.scrollToBottom(chatContainer),
        getWelcomeMessageHtml: window.TabManager.getWelcomeMessageHtml,
        attachPromptButtonListeners: () => window.TabManager.attachPromptButtonListeners(userInput),
        clearPendingImage,
        renderImagePreviews,
        updateTokenUsage,
        refreshTokenDisplay,
        handleInputChange,
        addSystemMessage,
        addAssistantMessage,
        saveCurrentTabState
      }
    });

    // Initialize tab tracking
    await initTabTracking();

    setupEventListeners();
    setupInputAutoResize();
  }

  // ============================================================================
  // TAB TRACKING
  // ============================================================================

  async function initTabTracking() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        currentTabId = tab.id;
        currentWindowId = tab.windowId;
        tabConversations.set(currentTabId, {
          conversation: [],
          tokenUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
          lastTurnTokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
          chatHtml: null,
          autonomyMode: autonomyMode
        });
        console.log(`[Sidebar] Initialized for window ${currentWindowId}, tab ${currentTabId}`);
        updateTabInfo();
        updateApiIndicator();
      }

      browser.tabs.onActivated.addListener(handleTabActivated);
      browser.tabs.onRemoved.addListener(handleTabRemoved);
      browser.tabs.onUpdated.addListener(handleTabUpdated);
    } catch (error) {
      console.error('Failed to initialize tab tracking:', error);
    }
  }

  function handleTabUpdated(tabId, changeInfo, _tab) {
    if (tabId === currentTabId && (changeInfo.url || changeInfo.title)) {
      updateTabInfo();
      updateApiIndicator();
    }
  }

  async function handleTabActivated(activeInfo) {
    const newTabId = activeInfo.tabId;
    if (newTabId === currentTabId) return;

    if (isStreaming && pendingTabSwitch === newTabId) {
      console.log('[TabSwitch] Ignoring activation of pending tab during streaming');
      return;
    }

    if (isStreaming) {
      console.log('[TabSwitch] Ignoring tab switch during streaming');
      return;
    }

    saveCurrentTabState();
    currentTabId = newTabId;
    loadTabState(newTabId);
    specsManager?.updateBadge();
    updateTabInfo();
    updateApiIndicator();
  }

  function handleTabRemoved(tabId, _removeInfo) {
    tabConversations.delete(tabId);
    console.log(`[TabSwitch] Cleaned up conversation for tab ${tabId}`);
  }

  function saveCurrentTabState() {
    if (!currentTabId) return;
    tabConversations.set(currentTabId, {
      conversation: [...conversation],
      tokenUsage: { ...tokenUsage },
      lastTurnTokens: { ...lastTurnTokens },
      chatHtml: chatContainer.innerHTML,
      scrollTop: chatContainer.scrollTop,
      autonomyMode: autonomyMode
    });
  }

  function loadTabState(tabId) {
    const savedState = tabConversations.get(tabId);

    if (isStreaming && streamingTabId !== tabId) {
      console.log('[LoadTabState] Resetting stuck streaming state');
      resetStreamingState();
    }

    if (pendingImages.length > 0) {
      clearPendingImages();
    }

    if (savedState) {
      conversation = [...savedState.conversation];
      tokenUsage = { ...savedState.tokenUsage };
      lastTurnTokens = savedState.lastTurnTokens ? { ...savedState.lastTurnTokens } : { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      autonomyMode = savedState.autonomyMode || 'ask';
      if (savedState.chatHtml) {
        chatContainer.innerHTML = savedState.chatHtml;
        reattachChatEventListeners();
        // Restore scroll position after DOM update
        if (savedState.scrollTop !== undefined) {
          requestAnimationFrame(() => {
            chatContainer.scrollTop = savedState.scrollTop;
          });
        }
      } else {
        chatContainer.innerHTML = window.TabManager.getWelcomeMessageHtml();
        window.TabManager.attachPromptButtonListeners(userInput);
      }
    } else {
      conversation = [];
      tokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      lastTurnTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      chatContainer.innerHTML = window.TabManager.getWelcomeMessageHtml();
      window.TabManager.attachPromptButtonListeners(userInput);
      tabConversations.set(tabId, {
        conversation: [],
        tokenUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        lastTurnTokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        chatHtml: null,
        autonomyMode: autonomyMode
      });
    }

    refreshTokenDisplay();
    handleInputChange();
    window.ModalManager.autonomy.updateUI();
  }

  function reattachChatEventListeners() {
    window.TabManager.reattachChatEventListeners(chatContainer, {
      handleCopyTaskClick
    });
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  async function loadSettings() {
    try {
      const result = await browser.storage.local.get(['autonomyMode', 'defaultModel', 'highRiskTools']);

      if (result.autonomyMode) {
        autonomyMode = result.autonomyMode;
        window.ModalManager?.autonomy?.updateUI?.();
      }

      if (result.defaultModel) {
        selectedModel = result.defaultModel;
        modelSelect.value = selectedModel;
      }

      if (result.highRiskTools) {
        configuredHighRiskTools = result.highRiskTools;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.highRiskTools) {
        configuredHighRiskTools = changes.highRiskTools.newValue;
      }
    });
  }

  async function checkApiKey() {
    try {
      const result = await browser.storage.local.get(['apiKey', 'apiKeyStatus']);
      console.log('[Sidebar] API key check:', {
        hasKey: !!result.apiKey,
        keyLength: result.apiKey?.length || 0,
        status: result.apiKeyStatus
      });
      apiKeyConfigured = !!result.apiKey;
      if (!apiKeyConfigured) {
        console.log('[Sidebar] No API key found, showing modal');
        window.ModalManager.apiKey.show();
      }
    } catch (error) {
      console.error('[Sidebar] Failed to check API key:', error);
    }
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  function setupEventListeners() {
    // Send message
    sendBtn.addEventListener('click', handleSendMessage);
    userInput.addEventListener('keydown', handleInputKeydown);
    userInput.addEventListener('input', handleInputChange);

    // Model selection
    modelSelect.addEventListener('change', handleModelChange);

    // Clear chat (with confirmation)
    clearChatBtn.addEventListener('click', window.ModalManager.clearChat.show);
    clearConfirmCancel.addEventListener('click', window.ModalManager.clearChat.hide);
    clearConfirmApprove.addEventListener('click', window.ModalManager.clearChat.handleConfirm);

    // Menu toggle
    menuBtn.addEventListener('click', window.ModalManager.autonomy.toggleDropdown);

    // Autonomy dropdown
    autonomyBtn.addEventListener('click', window.ModalManager.autonomy.toggleMenu);
    autonomyOptions.forEach(option => {
      option.addEventListener('click', window.ModalManager.autonomy.handleChange);
    });

    // Screenshot button - takes screenshot and adds to image queue
    screenshotBtn.addEventListener('click', async () => {
      try {
        screenshotBtn.disabled = true;
        const result = await browser.runtime.sendMessage({ type: 'TAKE_SCREENSHOT' });
        if (result?.screenshot) {
          // Extract media type and base64 from data URL
          const match = result.screenshot.match(/^data:(image\/\w+);base64,(.+)$/);
          if (match) {
            pendingImages.push({ mediaType: match[1], base64: match[2] });
            renderImagePreviews();
            handleInputChange();
            userInput.focus();
          }
        }
      } catch (err) {
        console.error('Screenshot failed:', err);
      } finally {
        screenshotBtn.disabled = false;
      }
    });
    // Remove buttons are now per-image, created dynamically in renderImagePreviews()
    userInput.addEventListener('paste', window.ModalManager.attach.handlePaste);

    // Settings
    settingsMenuBtn.addEventListener('click', () => {
      browser.runtime.openOptionsPage();
      dropdownMenu.classList.add('hidden');
    });

    // Export context
    exportContextBtn.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      exportContext();
    });

    // Stop button
    stopBtn.addEventListener('click', handleStopGeneration);

    // Confirmation modal
    confirmCancel.addEventListener('click', window.ModalManager.confirm.cancel);
    confirmApprove.addEventListener('click', window.ModalManager.confirm.approve);
    document.getElementById('confirm-switch-mode')?.addEventListener('click', window.ModalManager.confirm.switchMode);

    // API key modal
    apiKeySave.addEventListener('click', window.ModalManager.apiKey.save);
    apiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') window.ModalManager.apiKey.save();
    });

    apiKeyInput.addEventListener('input', () => {
      apiKeyInput.classList.remove('error', 'success');
      const statusEl = document.getElementById('api-key-status');
      if (statusEl) {
        statusEl.classList.remove('visible', 'error', 'success', 'validating');
      }
    });

    // Close menus when clicking outside
    document.addEventListener('click', window.ModalManager.handleOutsideClick);

    // Listen for messages from background script
    browser.runtime.onMessage.addListener(handleBackgroundMessage);

    // Notes modal
    notesBtn.addEventListener('click', () => specsManager?.show());
    notesClose.addEventListener('click', () => specsManager?.hide());
    notesDone.addEventListener('click', () => specsManager?.hide());
    notesViewRendered.addEventListener('click', () => specsManager?.setView('rendered'));
    notesViewSource.addEventListener('click', () => specsManager?.setView('source'));
    notesClearAll.addEventListener('click', () => specsManager?.clearAll());
    document.getElementById('notes-save-source').addEventListener('click', () => {
      const saveBtn = document.getElementById('notes-save-source');
      specsManager?.saveRaw(saveBtn);
    });

    // Update notes badge on load
    specsManager?.updateBadge();

    // Populate welcome screen prompts from single source of truth
    const welcomePrompts = document.querySelector('.welcome-prompts');
    if (welcomePrompts) {
      welcomePrompts.innerHTML = window.TabManager.getWelcomePromptsHtml
        ? window.TabManager.getWelcomePromptsHtml()
        : '';
    }

    // Welcome prompt buttons (initial page load)
    window.TabManager.attachPromptButtonListeners(userInput);

    // Prompts dropdown menu — populate from single source of truth
    const promptsMenuBtn = document.getElementById('prompts-menu-btn');
    const promptsDropdown = document.getElementById('prompts-dropdown');

    if (promptsMenuBtn && promptsDropdown) {
      // Populate dropdown from PRESET_PROMPTS
      if (window.TabManager.getPromptsDropdownHtml) {
        promptsDropdown.innerHTML = window.TabManager.getPromptsDropdownHtml();
      }

      // Toggle dropdown on button click
      promptsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptsDropdown.classList.toggle('hidden');
      });

      // Handle prompt item clicks
      promptsDropdown.querySelectorAll('.prompt-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const prompt = btn.dataset.prompt;
          if (prompt) {
            userInput.value = prompt;
            userInput.style.height = 'auto';
            userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
            userInput.focus();
            userInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          promptsDropdown.classList.add('hidden');
        });
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!promptsMenuBtn.contains(e.target) && !promptsDropdown.contains(e.target)) {
          promptsDropdown.classList.add('hidden');
        }
      });
    }
  }

  function setupInputAutoResize() {
    userInput.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    });
  }

  // ============================================================================
  // INPUT HANDLING
  // ============================================================================

  function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  function handleInputChange() {
    const hasText = userInput.value.trim().length > 0;
    const hasImages = pendingImages.length > 0;
    sendBtn.disabled = (!hasText && !hasImages) || isStreaming;
  }

  async function handleSendMessage() {
    const text = userInput.value.trim();
    const hasImages = pendingImages.length > 0;

    if ((!text && !hasImages) || isStreaming) return;

    if (!apiKeyConfigured) {
      window.ModalManager.apiKey.show();
      return;
    }

    userInput.value = '';
    userInput.style.height = 'auto';
    sendBtn.disabled = true;

    const imagesToSend = hasImages ? [...pendingImages] : null;
    if (hasImages) {
      clearPendingImages();
    }

    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    let messageContent;
    let displayText = text;

    if (imagesToSend) {
      messageContent = imagesToSend.map(img => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64
        }
      }));
      if (text) {
        messageContent.push({ type: 'text', text: text });
      }
      displayText = text || `[${imagesToSend.length} image${imagesToSend.length > 1 ? 's' : ''}]`;
    } else {
      messageContent = text;
    }

    addMessageToUI('user', displayText, imagesToSend);
    conversation.push({ role: 'user', content: messageContent });
    await sendToBackground();
  }

  async function sendToBackground() {
    isStreaming = true;
    streamingTabId = currentTabId;
    currentStreamingTools = []; // Reset tool tracking for new response
    sendBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');

    const msgElement = createMessageElement('assistant', '');
    chatContainer.appendChild(msgElement);
    window.RenderUtils.scrollToBottom(chatContainer);

    const contentElement = msgElement.querySelector('.message-content');
    contentElement.innerHTML = '<span class="streaming-cursor"></span>';
    startThinkingTimer();

    // Send full conversation - auto-compression handles context limits
    try {
      const response = await browser.runtime.sendMessage({
        type: 'CHAT_MESSAGE',
        conversation: conversation,
        model: selectedModel,
        windowId: currentWindowId,
        autonomyMode: autonomyMode
      });

      if (response.error) {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      contentElement.innerHTML = '';
      addErrorToMessage(contentElement, error.message);
      resetStreamingState();
    }
  }

  function resetStreamingState() {
    isStreaming = false;
    streamingTabId = null;
    pendingTabSwitch = null;
    stopThinkingTimer();
    sendBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    sendBtn.disabled = userInput.value.trim().length === 0;
  }

  function startThinkingTimer() {
    stopThinkingTimer();
    const startTime = Date.now();
    thinkingTimer = {
      delayId: setTimeout(() => {
        const cursor = chatContainer.querySelector('.streaming-cursor');
        if (!cursor) return;
        const timerEl = document.createElement('span');
        timerEl.className = 'thinking-timer';
        timerEl.textContent = '0.0s';
        cursor.parentNode.insertBefore(timerEl, cursor.nextSibling);
        thinkingTimer.intervalId = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          timerEl.textContent = elapsed.toFixed(1) + 's';
        }, 100);
      }, 2500),
      intervalId: null
    };
  }

  function stopThinkingTimer() {
    if (!thinkingTimer) return;
    clearTimeout(thinkingTimer.delayId);
    if (thinkingTimer.intervalId) clearInterval(thinkingTimer.intervalId);
    const timerEl = chatContainer.querySelector('.thinking-timer');
    if (timerEl) timerEl.remove();
    thinkingTimer = null;
  }

  async function handleStopGeneration() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await browser.runtime.sendMessage({
        type: 'CANCEL_STREAM',
        tabId: tab.id
      });
      resetStreamingState();

      const lastMsg = chatContainer.querySelector('.message.assistant:last-child .message-content');
      if (lastMsg) {
        lastMsg.innerHTML += '<div class="stopped-notice">[Stopped by user]</div>';
      }
    } catch (error) {
      console.error('Failed to stop generation:', error);
    }
  }

  // ============================================================================
  // BACKGROUND MESSAGE HANDLING
  // ============================================================================

  function handleBackgroundMessage(message) {
    if (message.windowId !== undefined && message.windowId !== currentWindowId) {
      return;
    }

    console.log('[Sidebar] Received message:', message.type, message);

    switch (message.type) {
      case 'STREAM_DELTA':
        handleStreamDelta(message.text);
        break;
      case 'STREAM_TOOL_USE':
        handleToolUse({
          id: message.toolId,
          name: message.toolName,
          input: message.toolInput
        });
        break;
      case 'STREAM_END':
        handleStreamEnd();
        break;
      case 'STREAM_ERROR':
        handleStreamError(message.error);
        break;
      case 'TOOL_RESULT':
        handleToolResult(message.toolId, message.result, message.isError);
        break;
      case 'CONFIRM_TOOL':
        window.ModalManager.confirm.show(message.toolName, message.toolInput, message.toolId);
        break;
      case 'TOKEN_USAGE':
        updateTokenUsage(message.inputTokens, message.outputTokens, message.cacheCreationTokens, message.cacheReadTokens);
        break;
      case 'ITERATION_LIMIT_REACHED':
        showIterationLimitPrompt(message.promptId, message.currentIteration);
        break;
      case 'TAB_CREATED_BY_TOOL':
        handleTabCreatedByTool(message);
        break;
    }
  }

  function handleTabCreatedByTool(message) {
    if (message.tabId && message.tabId !== currentTabId) {
      if (isStreaming) {
        pendingTabSwitch = message.tabId;
        console.log('[TabSwitch] Deferring switch to tab', message.tabId, 'until streaming completes');
      } else {
        saveCurrentTabState();
        currentTabId = message.tabId;
        loadTabState(message.tabId);
        specsManager?.updateBadge();
        updateTabInfo();
        updateApiIndicator();
      }
    }
  }

  function showIterationLimitPrompt(promptId, currentIteration) {
    const existingPrompt = chatContainer.querySelector('.iteration-prompt');
    if (existingPrompt) existingPrompt.remove();

    const promptElement = document.createElement('div');
    promptElement.className = 'message system iteration-prompt';
    promptElement.dataset.iteration = currentIteration;
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

    const buttons = promptElement.querySelectorAll('.iteration-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const allowMore = parseInt(btn.dataset.allow, 10);

        // Unlimited mode requires confirmation
        if (allowMore === -1) {
          showUnlimitedConfirmation(promptId, promptElement);
          return;
        }

        respondToIterationPrompt(promptId, allowMore);
        promptElement.remove();
      });
    });

    chatContainer.appendChild(promptElement);
    window.RenderUtils.scrollToBottom(chatContainer);
  }

  function showUnlimitedConfirmation(promptId, promptElement) {
    const buttonsDiv = promptElement.querySelector('.iteration-prompt-buttons');
    buttonsDiv.innerHTML = `
      <div class="unlimited-warning">
        <div class="unlimited-warning-text">
          <strong>Are you sure?</strong>
          <p>Unlimited mode removes all action limits. Claude will continue until the task is complete, which could use many tokens.</p>
        </div>
      </div>
      <div class="unlimited-confirm-buttons">
        <button class="iteration-btn cancel-unlimited-btn">Cancel</button>
        <button class="iteration-btn confirm-unlimited-btn">Yes, allow unlimited</button>
      </div>
    `;

    buttonsDiv.querySelector('.cancel-unlimited-btn').addEventListener('click', () => {
      const iteration = parseInt(promptElement.dataset.iteration, 10) || 0;
      promptElement.remove();
      showIterationLimitPrompt(promptId, iteration);
    });

    buttonsDiv.querySelector('.confirm-unlimited-btn').addEventListener('click', () => {
      respondToIterationPrompt(promptId, -1);
      promptElement.remove();
    });

    window.RenderUtils.scrollToBottom(chatContainer);
  }

  function respondToIterationPrompt(promptId, allowMore) {
    browser.runtime.sendMessage({
      type: 'ITERATION_LIMIT_RESPONSE',
      promptId: promptId,
      allowMore: allowMore
    });

    if (allowMore === -1) {
      addEphemeralMessage('Unlimited mode enabled - no further prompts until task completes', 'warning', 5000);
    } else if (allowMore === -2) {
      addEphemeralMessage('Stopped.', 'info', 2000);
    } else if (allowMore > 0) {
      addEphemeralMessage(`Allowing ${allowMore} more actions...`, 'info', 3000);
    } else {
      addEphemeralMessage('Stopping and generating summary...', 'info', 3000);
    }
  }

  // ============================================================================
  // STREAMING HANDLERS
  // ============================================================================

  function handleStreamDelta(text) {
    stopThinkingTimer();
    window.StreamRenderer.handleDelta(
      text,
      { currentTabId, streamingTabId },
      { chatContainer },
      { scrollToBottom: () => window.RenderUtils.scrollToBottom(chatContainer) }
    );
  }

  function handleToolUse(toolUse) {
    stopThinkingTimer();
    // Track tool name for conversation history
    currentStreamingTools.push(toolUse.name);

    window.StreamRenderer.handleToolUse(
      toolUse,
      { currentTabId, streamingTabId, autonomyMode },
      { chatContainer },
      {
        createToolCallElement: (name, input, id) => createToolCallElement(name, input, id),
        scrollToBottom: () => window.RenderUtils.scrollToBottom(chatContainer),
        isHighRiskTool: (name) => configuredHighRiskTools.includes(name)
      }
    );
  }

  async function handleStreamEnd() {
    if (streamingTabId !== null && currentTabId !== streamingTabId) {
      resetStreamingState();
      return;
    }

    const msgElement = chatContainer.querySelector('.message.assistant:last-child');
    if (!msgElement) return;

    const contentElement = msgElement.querySelector('.message-content');

    // Remove streaming cursor and indicator
    const cursor = contentElement.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();
    const indicator = contentElement.querySelector('.streaming-indicator');
    if (indicator) indicator.remove();

    // Get accumulated text
    const textContainer = contentElement.querySelector('.text-content');
    let finalText = textContainer ? (textContainer.dataset.rawText || '') : '';

    // Show text container
    if (textContainer) {
      textContainer.classList.remove('streaming-hidden');
    }

    // Process learned experiences and strip metadata
    if (finalText) {
      await processLearnedExperiences(finalText);
      finalText = stripLearnedBlocks(finalText);
      finalText = stripSpecBlocks(finalText);

      const complexityScore = parseComplexityScore(finalText);
      finalText = stripComplexityScore(finalText);

      // Show footer if tools were used OR if complexity score exists
      const hasTools = currentStreamingTools.length > 0;
      if (hasTools || complexityScore !== null) {
        addComplexityFooter(msgElement, complexityScore);
      }
    }

    // Reorganize DOM using StreamRenderer
    window.StreamRenderer.finalizeMessage(contentElement, finalText, {
      renderMarkdownContent: window.RenderUtils.renderMarkdownContent
    });

    // Add to conversation - strip working notes and include tool usage marker
    if (finalText) {
      // Strip <work>...</work> tags - only keep final answer for conversation history
      let contentToStore = finalText.replace(/<work>[\s\S]*?<\/work>/gi, '').trim();

      // Add tool usage marker if tools were used
      if (currentStreamingTools.length > 0) {
        const uniqueTools = [...new Set(currentStreamingTools)];
        contentToStore = `[Tools used: ${uniqueTools.join(', ')}]\n\n${contentToStore}`;
      }

      // Only store if there's actual content after stripping
      if (contentToStore) {
        conversation.push({ role: 'assistant', content: contentToStore });
      }
    }

    // Update activity count
    const activityLog = contentElement?.querySelector('.activity-log');
    if (activityLog) {
      window.ActivityLog.updateCount(activityLog);
    }

    window.RenderUtils.forceScrollToBottom(chatContainer);

    // Handle pending tab switch
    const tabToSwitchTo = pendingTabSwitch;
    resetStreamingState();

    if (tabToSwitchTo && tabToSwitchTo !== currentTabId) {
      console.log('[TabSwitch] Streaming complete, switching to pending tab', tabToSwitchTo);
      saveCurrentTabState();
      currentTabId = tabToSwitchTo;
      loadTabState(tabToSwitchTo);
      specsManager?.updateBadge();
      updateTabInfo();
      updateApiIndicator();
    }

    // Check if context compression is needed
    checkAndCompressContext();
  }

  async function checkAndCompressContext() {
    if (!window.ContextManager) return;

    const totalTokens = tokenUsage.input + lastTurnTokens.input;
    const check = window.ContextManager.checkCompressionNeeded(totalTokens, conversation);

    if (check.needsCompression) {
      console.log(`[ContextManager] Compression triggered: ${check.reason}`);

      // Save current state BEFORE compression as backup
      const backupConversation = [...conversation];
      const backupChatHtml = chatContainer.innerHTML;

      // Show compression notice
      showSystemMessage(`Compressing conversation history... (${check.reason})`);

      try {
        const compressed = await window.ContextManager.compressConversation(
          conversation,
          async (textToSummarize) => {
            // Call background to get summary from Claude
            const response = await browser.runtime.sendMessage({
              type: 'SUMMARIZE_CONTEXT',
              text: textToSummarize
            });
            return response.summary || 'Previous conversation about browser automation tasks.';
          }
        );

        conversation = compressed;
        // Estimate compressed size (~2k for summary + ~3k per kept pair)
        const estimatedTokens = 2000 + (window.ContextManager.CONFIG.KEEP_RECENT_PAIRS * 3000);
        tokenUsage = { input: estimatedTokens, output: 0, cacheCreation: 0, cacheRead: 0 };
        lastTurnTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        refreshTokenDisplay();

        // IMPORTANT: Save tab state immediately to preserve chat UI
        saveCurrentTabState();

        showSystemMessage(`Context compressed (~${Math.round(estimatedTokens/1000)}k tokens estimated)`);
        console.log('[ContextManager] Compression complete');
      } catch (error) {
        console.error('[ContextManager] Compression failed:', error);
        // Restore backup if chat was somehow lost
        if (!chatContainer.innerHTML || chatContainer.innerHTML.includes('welcome-message')) {
          console.log('[ContextManager] Restoring chat UI from backup');
          chatContainer.innerHTML = backupChatHtml;
          conversation = backupConversation;
        } else {
          // Fallback: apply sliding window
          conversation = window.ContextManager.applySlidingWindow(conversation);
        }
        saveCurrentTabState();
      }
    }
  }

  function showSystemMessage(text) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message system';
    msgElement.innerHTML = `<div class="message-content"><em>${text}</em></div>`;
    chatContainer.appendChild(msgElement);
    window.RenderUtils.scrollToBottom(chatContainer);
    // Auto-remove after 5 seconds
    setTimeout(() => msgElement.remove(), 5000);
  }

  function handleStreamError(error) {
    window.StreamRenderer.handleError(
      error,
      { currentTabId, streamingTabId },
      { chatContainer },
      { resetStreamingState }
    );
  }

  function handleToolResult(toolId, result, isError) {
    if (streamingTabId !== null && currentTabId !== streamingTabId) {
      return;
    }

    window.ActivityLog.updateResult(chatContainer, toolId, result, isError, {
      onSiteSpecSaved: () => specsManager?.updateBadge()
    });

    requestAnimationFrame(() => {
      const activityLog = chatContainer.querySelector('.activity-log');
      if (activityLog) {
        window.ActivityLog.updateCount(activityLog);
      }
    });

    window.RenderUtils.forceScrollToBottom(chatContainer);
  }

  // ============================================================================
  // ACTIVITY LOG HELPERS
  // ============================================================================

  function createToolCallElement(toolName, toolInput, toolId) {
    window.ActivityLog.addTool(chatContainer, toolName, toolInput, toolId, configuredHighRiskTools);
    const placeholder = document.createElement('span');
    placeholder.style.display = 'none';
    return placeholder;
  }

  // ============================================================================
  // MESSAGE CREATION
  // ============================================================================

  function createMessageElement(role, content, image = null) {
    return window.StreamRenderer.createMessageElement(role, content, image, {
      onCopyTask: handleCopyTaskClick
    });
  }

  function addMessageToUI(role, content, image = null) {
    const msgElement = createMessageElement(role, content, image);
    chatContainer.appendChild(msgElement);
    window.RenderUtils.scrollToBottom(chatContainer);
  }

  function addErrorToMessage(contentElement, errorMessage) {
    window.StreamRenderer.addErrorToMessage(contentElement, errorMessage);
  }

  function addSystemMessage(text) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message system';
    msgElement.innerHTML = `
      <div class="message-content system-content">
        <span class="system-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </span>
        <span>${text}</span>
      </div>
    `;
    chatContainer.appendChild(msgElement);
    window.RenderUtils.scrollToBottom(chatContainer);
  }

  function addEphemeralMessage(text, type = 'info', autoDismiss = 5000) {
    const icons = {
      success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><polyline points="9,12 12,15 16,10"/>
      </svg>`,
      error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>`,
      info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>`
    };

    const msgElement = document.createElement('div');
    msgElement.className = `message ephemeral ${type}`;
    msgElement.innerHTML = `
      <div class="message-content">
        <div class="ephemeral-content">
          <span class="ephemeral-icon">${icons[type] || icons.info}</span>
          <span class="ephemeral-text">${window.RenderUtils.escapeHtml(text)}</span>
          <button class="ephemeral-dismiss" title="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    const dismissBtn = msgElement.querySelector('.ephemeral-dismiss');
    const dismiss = () => {
      msgElement.classList.add('fading-out');
      setTimeout(() => msgElement.remove(), 300);
    };
    dismissBtn.addEventListener('click', dismiss);

    chatContainer.appendChild(msgElement);
    window.RenderUtils.scrollToBottom(chatContainer);

    if (autoDismiss) {
      setTimeout(dismiss, autoDismiss);
    }

    return msgElement;
  }

  function addAssistantMessage(text) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message assistant';
    msgElement.innerHTML = `
      <div class="message-content">
        <span class="text-content">${window.RenderUtils.escapeHtml(text)}</span>
      </div>
    `;
    chatContainer.appendChild(msgElement);
    window.RenderUtils.scrollToBottom(chatContainer);
  }

  // ============================================================================
  // TOKEN DISPLAY
  // ============================================================================

  /**
   * Refreshes the token display based on current tokenUsage and lastTurnTokens values.
   * Use this when restoring state (tab switch, clear) - no accumulation.
   */
  function refreshTokenDisplay() {
    const tokenDisplay = document.getElementById('token-display');
    if (!tokenDisplay) return;

    function toK(n) { return `${(n / 1000).toFixed(1)}k`; }

    const lastTurnTotal = lastTurnTokens.input + lastTurnTokens.output;
    const cumulativeTotal = tokenUsage.input + tokenUsage.output + lastTurnTotal;
    const cacheRead = tokenUsage.cacheRead + lastTurnTokens.cacheRead;

    // Format: "2.3k (+0.8k)" or "2.3k (+0.8k) | 1.2k cached"
    let displayText = toK(cumulativeTotal);
    if (lastTurnTotal > 0) displayText += ` (+${toK(lastTurnTotal)})`;
    if (cacheRead > 0) displayText += ` | ${toK(cacheRead)} cached`;
    tokenDisplay.textContent = displayText;

    // Visual tier based on cumulative token count
    const tierClasses = ['token-tier-warm', 'token-tier-hot', 'token-tier-critical'];
    tokenDisplay.classList.remove(...tierClasses);
    if (cumulativeTotal >= 150000) {
      tokenDisplay.classList.add('token-tier-critical');
    } else if (cumulativeTotal >= 100000) {
      tokenDisplay.classList.add('token-tier-hot');
    } else if (cumulativeTotal >= 50000) {
      tokenDisplay.classList.add('token-tier-warm');
    }

    // Brief scale pulse on update (reflow forces animation restart)
    tokenDisplay.classList.remove('token-pulse');
    void tokenDisplay.offsetWidth;
    tokenDisplay.classList.add('token-pulse');

    // Detailed tooltip
    const cumulativeInput = tokenUsage.input + lastTurnTokens.input;
    const cumulativeOutput = tokenUsage.output + lastTurnTokens.output;
    const cacheCreation = tokenUsage.cacheCreation + lastTurnTokens.cacheCreation;

    const tooltipLines = [
      `Cumulative: ${cumulativeInput.toLocaleString()} in / ${cumulativeOutput.toLocaleString()} out`,
      `Last turn: ${lastTurnTokens.input.toLocaleString()} in / ${lastTurnTokens.output.toLocaleString()} out`,
    ];
    if (cacheRead > 0 || cacheCreation > 0) {
      tooltipLines.push('--- Cache ---');
      if (cacheRead > 0) tooltipLines.push(`Cache read: ${cacheRead.toLocaleString()} tokens`);
      if (cacheCreation > 0) tooltipLines.push(`Cache write: ${cacheCreation.toLocaleString()} tokens`);
    }
    tokenDisplay.title = tooltipLines.join('\n');
  }

  /**
   * Updates token usage from streaming events.
   * When inputTokens is provided, it's a new turn - previous lastTurn gets accumulated.
   */
  function updateTokenUsage(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens) {
    // When inputTokens comes in, it's a new turn - reset last turn tracking
    if (inputTokens !== undefined) {
      // Add previous last turn to cumulative before resetting
      tokenUsage.input += lastTurnTokens.input;
      tokenUsage.output += lastTurnTokens.output;
      tokenUsage.cacheCreation += lastTurnTokens.cacheCreation;
      tokenUsage.cacheRead += lastTurnTokens.cacheRead;

      // Reset last turn and set new input
      lastTurnTokens = { input: inputTokens, output: 0, cacheCreation: 0, cacheRead: 0 };
      if (cacheCreationTokens !== undefined) lastTurnTokens.cacheCreation = cacheCreationTokens;
      if (cacheReadTokens !== undefined) lastTurnTokens.cacheRead = cacheReadTokens;
    }

    // Output tokens come later in the same turn
    if (outputTokens !== undefined) lastTurnTokens.output = outputTokens;

    refreshTokenDisplay();
  }

  async function updateTabInfo() {
    const tabInfoText = document.getElementById('tab-info-text');
    const tabInfo = document.getElementById('tab-info');
    if (!tabInfoText || !tabInfo) return;

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        let displayText = '';
        let tooltipText = '';

        try {
          const url = new URL(tab.url);
          displayText = url.hostname.replace(/^www\./, '');
          tooltipText = `${tab.title}\n${tab.url}`;
        } catch {
          displayText = tab.title || tab.url || 'Unknown';
          tooltipText = tab.url || '';
        }

        tabInfoText.textContent = displayText;
        tabInfo.title = tooltipText;
      }
    } catch (error) {
      console.error('Failed to update tab info:', error);
      tabInfoText.textContent = 'Unknown';
    }
  }

  // ============================================================================
  // API OBSERVER INDICATOR
  // ============================================================================

  async function updateApiIndicator() {
    const indicator = document.getElementById('api-indicator');
    const countEl = document.getElementById('api-indicator-count');
    if (!indicator || !countEl) return;

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) {
        indicator.classList.add('hidden');
        return;
      }

      let domain;
      try {
        domain = new URL(tab.url).hostname.replace(/^www\./, '');
      } catch {
        indicator.classList.add('hidden');
        return;
      }

      const counts = await browser.runtime.sendMessage({ type: 'GET_OBSERVER_COUNTS', domain });
      const apiCount = counts?.api || 0;
      const domCount = counts?.dom || 0;
      const totalCount = apiCount + domCount;

      if (totalCount > 0) {
        countEl.textContent = totalCount;
        const parts = [];
        if (apiCount > 0) parts.push(`${apiCount} API endpoint${apiCount !== 1 ? 's' : ''}`);
        if (domCount > 0) parts.push(`${domCount} DOM pattern${domCount !== 1 ? 's' : ''}`);
        indicator.title = `${parts.join(', ')} observed on ${domain}`;
        indicator.classList.remove('hidden');
        indicator.classList.add('has-patterns');
      } else {
        indicator.classList.add('hidden');
        indicator.classList.remove('has-patterns');
      }
    } catch (e) {
      indicator.classList.add('hidden');
    }
  }

  // Refresh indicator periodically so count updates while browsing
  setInterval(updateApiIndicator, 10000);

  // Click indicator to paste a prompt querying captured data
  const apiIndicator = document.getElementById('api-indicator');
  if (apiIndicator) {
    apiIndicator.style.cursor = 'pointer';
    apiIndicator.addEventListener('click', () => {
      const prompt = 'List all observed API endpoints and DOM patterns for this site with full paths and hit counts.';
      userInput.value = prompt;
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
      userInput.focus();
      handleInputChange();
    });
  }

  // ============================================================================
  // LEARNING SYSTEM
  // ============================================================================

  async function processLearnedExperiences(text) {
    const learned = parseLearnedBlocks(text);
    if (learned.length === 0) return;

    const domain = await getCurrentDomain();
    if (!domain) {
      console.warn('[Experiences] Could not get current domain');
      return;
    }

    for (const exp of learned) {
      try {
        const result = await browser.runtime.sendMessage({
          type: 'ADD_EXPERIENCE',
          domain: domain,
          experience: exp
        });

        if (result?.success) {
          console.log(`[Experiences] Saved: "${exp.issue}" for ${domain}`);
        }
      } catch (error) {
        console.error('[Experiences] Failed to save:', error);
      }
    }
  }

  function parseLearnedBlocks(text) {
    const learned = [];
    const regex = /<!--LEARNED\s*([\s\S]*?)-->/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const block = match[1].trim();
      const exp = parseLearnedBlock(block);
      if (exp) {
        learned.push(exp);
      }
    }

    return learned;
  }

  function parseLearnedBlock(block) {
    const lines = block.split('\n');
    const exp = {};

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      switch (key) {
        case 'issue': exp.issue = value; break;
        case 'solution': exp.solution = value; break;
        case 'selector': exp.selector = value; break;
        case 'context': exp.context = value; break;
      }
    }

    if (exp.issue && exp.solution) {
      return exp;
    }
    return null;
  }

  function stripLearnedBlocks(text) {
    return text.replace(/<!--LEARNED\s*[\s\S]*?-->\s*/g, '');
  }

  function stripSpecBlocks(text) {
    return text.replace(/<!--SPEC\s*[\s\S]*?-->\s*/g, '');
  }

  // ============================================================================
  // COMPLEXITY SCORE
  // ============================================================================

  function parseComplexityScore(text) {
    return window.StreamRenderer.parseComplexityScore(text);
  }

  function stripComplexityScore(text) {
    return window.StreamRenderer.stripComplexityScore(text);
  }

  function addComplexityFooter(msgElement, score) {
    window.StreamRenderer.addComplexityFooter(msgElement, score);
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  async function getCurrentDomain() {
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_CURRENT_TAB_URL'
      });

      if (response?.url) {
        const url = new URL(response.url);
        return url.hostname.replace(/^www\./, '');
      }
    } catch (error) {
      console.error('[Experiences] Error getting domain:', error);
    }
    return null;
  }

  function handleModelChange() {
    selectedModel = modelSelect.value;
  }

  function clearPendingImages() {
    pendingImages = [];
    renderImagePreviews();
    handleInputChange();
  }

  // Legacy alias for modal-manager compatibility
  function clearPendingImage() {
    clearPendingImages();
  }

  function renderImagePreviews() {
    let previewGrid = imagePreviewContainer.querySelector('.image-preview-grid');
    if (!previewGrid) {
      previewGrid = document.createElement('div');
      previewGrid.className = 'image-preview-grid';
      imagePreviewContainer.innerHTML = '';
      imagePreviewContainer.appendChild(previewGrid);
    }
    previewGrid.innerHTML = '';

    if (pendingImages.length === 0) {
      imagePreviewContainer.classList.add('hidden');
      return;
    }

    pendingImages.forEach((img, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'image-preview-thumb';

      const imgEl = document.createElement('img');
      imgEl.className = 'image-preview';
      imgEl.src = `data:${img.mediaType};base64,${img.base64}`;
      imgEl.alt = `Image ${idx + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-image-btn';
      removeBtn.title = 'Remove image';
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.addEventListener('click', () => {
        pendingImages.splice(idx, 1);
        renderImagePreviews();
        handleInputChange();
      });

      thumb.appendChild(imgEl);
      thumb.appendChild(removeBtn);
      previewGrid.appendChild(thumb);
    });

    imagePreviewContainer.classList.remove('hidden');
  }

  // ============================================================================
  // EXPORT CONTEXT
  // ============================================================================

  async function exportContext() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      const result = await browser.runtime.sendMessage({
        type: 'EXPORT_CONTEXT',
        conversation: conversation,
        model: selectedModel,
        tabId: tab?.id,
        tabUrl: tab?.url
      });

      if (result.error) {
        console.error('Export context error:', result.error);
        addEphemeralMessage(`Export failed: ${result.error}`, 'error', 5000);
        return;
      }

      const exportData = {
        timestamp: new Date().toISOString(),
        model: selectedModel,
        tabUrl: tab?.url,
        tokenUsage: tokenUsage,
        ...result.context
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-context-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addEphemeralMessage('Context exported successfully', 'success', 3000);
    } catch (error) {
      console.error('Export context error:', error);
      addEphemeralMessage(`Export failed: ${error.message}`, 'error', 5000);
    }
  }

  // ============================================================================
  // COPY TASK
  // ============================================================================

  async function handleCopyTaskClick(msgElement) {
    const btn = msgElement.querySelector('.copy-task-btn');
    if (!btn) return;

    try {
      const messages = Array.from(chatContainer.querySelectorAll('.message'));
      const msgIndex = messages.indexOf(msgElement);

      let userRequest = '';
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].classList.contains('user')) {
          userRequest = messages[i].querySelector('.message-content')?.textContent || '';
          break;
        }
      }

      const contentElement = msgElement.querySelector('.message-content');
      const textContainer = contentElement?.querySelector('.text-content');
      const responseText = textContainer?.querySelector('.response-text')?.textContent
        || textContainer?.dataset?.rawText
        || textContainer?.textContent
        || '';

      const toolCalls = [];
      const activityItems = contentElement?.querySelectorAll('.activity-item') || [];
      activityItems.forEach(item => {
        const name = item.querySelector('.activity-item-name')?.textContent || '';
        const inputEl = item.querySelector('.activity-detail-content');
        const resultEl = item.querySelector('.result-content');

        let input = {};
        try {
          input = JSON.parse(inputEl?.textContent || '{}');
        } catch (e) {
          input = inputEl?.textContent || '';
        }

        let result = resultEl?.textContent || '';
        if (result.length > 1000) {
          result = result.substring(0, 1000) + '... [truncated]';
        }

        if (name) {
          toolCalls.push({ name, input, result });
        }
      });

      const taskData = {
        timestamp: new Date().toISOString(),
        request: userRequest,
        response: responseText || null,
        toolCalls: toolCalls.length > 0 ? toolCalls : null
      };

      const jsonStr = JSON.stringify(taskData, null, 2);
      await navigator.clipboard.writeText(jsonStr);

      btn.classList.add('copied');
      btn.title = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.title = 'Copy task as JSON';
      }, 2000);

      const toolCount = toolCalls.length;
      const summary = toolCount > 0
        ? `Task copied (${toolCount} tool call${toolCount !== 1 ? 's' : ''})`
        : 'Task copied to clipboard';
      addEphemeralMessage(summary, 'success', 3000);

    } catch (err) {
      console.error('[CopyTask] Error:', err);
      btn.title = 'Copy failed';
      addEphemeralMessage('Failed to copy task', 'error', 3000);
      setTimeout(() => {
        btn.title = 'Copy task as JSON';
      }, 2000);
    }
  }

  // ============================================================================
  // BOOTSTRAP
  // ============================================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
