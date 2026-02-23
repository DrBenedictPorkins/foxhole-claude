/**
 * Tab Manager Module
 * Handles per-tab conversation state, tab tracking, and tab-related event handling.
 *
 * This module manages:
 * - Initializing browser.tabs event listeners
 * - Saving/restoring conversation state when switching tabs
 * - Cleaning up state when tabs are closed
 * - Generating welcome message HTML and attaching prompt button handlers
 */

/**
 * @typedef {Object} TokenUsage
 * @property {number} input - Input tokens used
 * @property {number} output - Output tokens generated
 * @property {number} cacheCreation - Cache creation tokens
 * @property {number} cacheRead - Cache read tokens
 */

/**
 * @typedef {Object} TabState
 * @property {Array} conversation - Conversation history for this tab
 * @property {TokenUsage} tokenUsage - Token usage for this tab
 * @property {string|null} chatHtml - Saved HTML content of chat container
 * @property {string} autonomyMode - 'ask' or 'auto'
 */

/**
 * @typedef {Object} TabManagerState
 * @property {Map<number, TabState>} tabConversations - Map of tab ID to conversation state
 * @property {Array} conversation - Current active conversation
 * @property {TokenUsage} tokenUsage - Current token usage
 * @property {number|null} currentTabId - Currently active tab ID
 * @property {number|null} currentWindowId - Current window ID for message filtering
 * @property {boolean} isStreaming - Whether a stream is in progress
 * @property {number|null} streamingTabId - Tab ID associated with current stream
 * @property {number|null} pendingTabSwitch - Tab to switch to after streaming completes
 * @property {string} autonomyMode - Current autonomy mode ('ask' or 'auto')
 * @property {Array} pendingImages - Pending images to send with next message
 */

/**
 * @typedef {Object} TabManagerElements
 * @property {HTMLElement} chatContainer - Chat container element
 * @property {HTMLTextAreaElement} userInput - User input textarea
 */

/**
 * @typedef {Object} TabManagerCallbacks
 * @property {Function} updateTabInfo - Updates tab info display
 * @property {Function} updateNotesBadge - Updates notes badge for current domain
 * @property {Function} resetStreamingState - Resets streaming state
 * @property {Function} clearPendingImage - Clears pending image
 * @property {Function} updateTokenUsage - Updates token usage display
 * @property {Function} handleInputChange - Handles input change to update button state
 * @property {Function} updateAutonomyUI - Updates autonomy UI to reflect current setting
 * @property {Function} handleCopyTaskClick - Handles copy task button click
 */

/**
 * Creates a default token usage object.
 * @returns {TokenUsage} Default token usage with all values at 0
 */
function createDefaultTokenUsage() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/**
 * Initializes tab tracking for per-tab conversations.
 * Sets up event listeners for tab activation, removal, and updates.
 *
 * @param {TabManagerState} state - Shared state object
 * @param {TabManagerCallbacks} callbacks - Callback functions for UI updates
 * @returns {Promise<void>}
 */
async function initTabTracking(state, callbacks) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      state.currentTabId = tab.id;
      state.currentWindowId = tab.windowId;

      state.tabConversations.set(state.currentTabId, {
        conversation: [],
        tokenUsage: createDefaultTokenUsage(),
        chatHtml: null,
        autonomyMode: state.autonomyMode
      });
      console.log(`[Sidebar] Initialized for window ${state.currentWindowId}, tab ${state.currentTabId}`);

      callbacks.updateTabInfo();
    }

    browser.tabs.onActivated.addListener((activeInfo) => {
      handleTabActivated(activeInfo, state, callbacks);
    });
    browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
      handleTabRemoved(tabId, removeInfo, state);
    });
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      handleTabUpdated(tabId, changeInfo, tab, state, callbacks);
    });
  } catch (error) {
    console.error('Failed to initialize tab tracking:', error);
  }
}

/**
 * Handles tab URL/title updates.
 * Updates the tab info display when the current tab's URL or title changes.
 *
 * @param {number} tabId - The tab ID that was updated
 * @param {Object} changeInfo - Object containing changed properties
 * @param {browser.tabs.Tab} _tab - The tab object (unused)
 * @param {TabManagerState} state - Shared state object
 * @param {TabManagerCallbacks} callbacks - Callback functions for UI updates
 */
function handleTabUpdated(tabId, changeInfo, _tab, state, callbacks) {
  if (tabId === state.currentTabId && (changeInfo.url || changeInfo.title)) {
    callbacks.updateTabInfo();
  }
}

/**
 * Handles tab activation (user switched tabs).
 * Saves current tab state and loads the new tab's state.
 * Ignores switches during active streaming to prevent UI disruption.
 *
 * @param {Object} activeInfo - Object containing tabId and windowId
 * @param {number} activeInfo.tabId - The newly activated tab ID
 * @param {TabManagerState} state - Shared state object
 * @param {TabManagerCallbacks} callbacks - Callback functions for UI updates
 */
async function handleTabActivated(activeInfo, state, callbacks) {
  const newTabId = activeInfo.tabId;

  if (newTabId === state.currentTabId) return;

  if (state.isStreaming && state.pendingTabSwitch === newTabId) {
    console.log('[TabSwitch] Ignoring activation of pending tab during streaming');
    return;
  }

  if (state.isStreaming) {
    console.log('[TabSwitch] Ignoring tab switch during streaming');
    return;
  }

  saveCurrentTabState(state);

  state.currentTabId = newTabId;
  loadTabState(newTabId, state, callbacks);

  callbacks.updateNotesBadge();
  callbacks.updateTabInfo();
}

/**
 * Handles tab removal (tab closed).
 * Cleans up the conversation state for the closed tab.
 *
 * @param {number} tabId - The closed tab ID
 * @param {Object} _removeInfo - Remove info object (unused)
 * @param {TabManagerState} state - Shared state object
 */
function handleTabRemoved(tabId, _removeInfo, state) {
  state.tabConversations.delete(tabId);
  console.log(`[TabSwitch] Cleaned up conversation for tab ${tabId}`);
}

/**
 * Saves the current tab's conversation state.
 * Stores conversation, token usage, chat HTML, and autonomy mode.
 *
 * @param {TabManagerState} state - Shared state object
 * @param {HTMLElement} [chatContainer] - Optional chat container for HTML snapshot
 */
function saveCurrentTabState(state, chatContainer) {
  if (!state.currentTabId) return;

  const chatHtml = chatContainer ? chatContainer.innerHTML : null;

  state.tabConversations.set(state.currentTabId, {
    conversation: [...state.conversation],
    tokenUsage: { ...state.tokenUsage },
    chatHtml: chatHtml,
    autonomyMode: state.autonomyMode
  });
}

/**
 * Loads a tab's conversation state.
 * Restores conversation, token usage, chat HTML, and autonomy mode.
 * For new tabs, initializes fresh state with default settings.
 *
 * @param {number} tabId - The tab ID to load state for
 * @param {TabManagerState} state - Shared state object
 * @param {TabManagerCallbacks} callbacks - Callback functions for UI updates
 * @param {TabManagerElements} [elements] - DOM elements for chat updates
 */
function loadTabState(tabId, state, callbacks, elements) {
  const savedState = state.tabConversations.get(tabId);

  if (state.isStreaming && state.streamingTabId !== tabId) {
    console.log('[LoadTabState] Resetting stuck streaming state');
    callbacks.resetStreamingState();
  }

  if (state.pendingImages && state.pendingImages.length > 0) {
    callbacks.clearPendingImage();
  }

  if (savedState) {
    state.conversation = [...savedState.conversation];
    state.tokenUsage = { ...savedState.tokenUsage };
    state.autonomyMode = savedState.autonomyMode || 'ask';

    if (elements && savedState.chatHtml) {
      elements.chatContainer.innerHTML = savedState.chatHtml;
      reattachChatEventListeners(elements.chatContainer, callbacks);
    } else if (elements) {
      elements.chatContainer.innerHTML = getWelcomeMessageHtml();
      attachPromptButtonListeners(elements.userInput);
    }
  } else {
    state.conversation = [];
    state.tokenUsage = createDefaultTokenUsage();

    if (elements) {
      elements.chatContainer.innerHTML = getWelcomeMessageHtml();
      attachPromptButtonListeners(elements.userInput);
    }

    state.tabConversations.set(tabId, {
      conversation: [],
      tokenUsage: createDefaultTokenUsage(),
      chatHtml: null,
      autonomyMode: state.autonomyMode
    });
  }

  callbacks.updateTokenUsage(
    state.tokenUsage.input,
    state.tokenUsage.output,
    state.tokenUsage.cacheCreation,
    state.tokenUsage.cacheRead
  );
  callbacks.handleInputChange();
  callbacks.updateAutonomyUI();
}

/**
 * Preset prompts — single source of truth for welcome screen + hamburger menu.
 * Items with menuOnly:true appear only in the hamburger dropdown, not on the welcome screen.
 * Items with divider:true render as visual separators.
 */
const PRESET_PROMPTS = [
  { icon: null, label: 'Analyze Page', prompt: "What's on this page? Give me a quick summary.", menuOnly: true },
  { icon: null, label: 'Visual Selection', prompt: 'Let me select some items on this page visually.', menuOnly: true },
  { divider: true },
  { icon: '🔍', label: 'Record API Traffic', prompt: 'Monitor network traffic as I browse this site. Summarize API endpoints, methods, and request patterns. For large payloads, just note the structure - don\'t dump raw data. I want to understand how to replicate this site\'s functionality programmatically.' },
  { icon: '📋', label: 'Document APIs', prompt: 'Analyze the network calls captured so far. Document the internal APIs: list endpoints, auth headers, request formats, and response structures. Create a quick reference I can use to call these APIs directly.' },
  { icon: '🗺️', label: 'Map DOM Structure', prompt: "Analyze this page's DOM structure and document the key selectors for: navigation, search, product/item listings, forms, and interactive elements. Save as site specs for future reference." },
  { divider: true },
  { icon: '🛡️', label: 'Security Audit', prompt: 'Audit this page for privacy and security issues. Check for: third-party trackers and analytics scripts, dark patterns (hidden opt-ins, misleading buttons, forced consent), exposed data in the DOM or network requests, insecure form actions, and suspicious external resource loading. Summarize findings by severity.' },
  { icon: '🧲', label: 'Extract Content', prompt: "Extract content from this page. Scan the DOM to see what's here, then ask me what I want to keep (e.g., just posts, just products, just articles). Once I tell you, extract that content and replace the page with a clean version — no ads, no trackers, no clutter." },
  { divider: true },
  { icon: '🔬', label: 'Dev Audit', prompt: 'Run a developer audit on this page. Detect the tech stack (frameworks, state management, UI libraries, build tools, analytics), check Core Web Vitals and performance metrics, and run a WCAG accessibility audit. Summarize all findings with actionable issues.' },
  { icon: '🧬', label: 'Deep Recon', prompt: 'Stay in this tab. No new tabs, no navigation, no fetching endpoints. Run detect_page_tech, read get_network_requests for already-captured traffic, and inspect_app_state for live data. Top 3 per category max. Map: which DOM sections use which APIs, what state drives the UI, what\'s API-callable vs UI-only. Save a site profile and key specs.' },
];

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Generate welcome screen prompt buttons (excludes menuOnly items and dividers).
 */
function getWelcomePromptsHtml() {
  return PRESET_PROMPTS
    .filter(p => !p.divider && !p.menuOnly)
    .map(p => `<button class="prompt-btn" data-prompt="${escapeAttr(p.prompt)}">${p.icon} ${p.label}</button>`)
    .join('\n        ');
}

/**
 * Generate hamburger dropdown menu items (all items including menuOnly).
 */
function getPromptsDropdownHtml() {
  return PRESET_PROMPTS
    .map(p => {
      if (p.divider) return '<div class="prompt-divider"></div>';
      return `<button class="prompt-item" data-prompt="${escapeAttr(p.prompt)}">${p.label}</button>`;
    })
    .join('\n');
}

/**
 * Returns the HTML for the welcome message shown when starting a new conversation.
 *
 * @returns {string} HTML string for the welcome message
 */
function getWelcomeMessageHtml() {
  return `
    <div class="welcome-message">
      <div class="welcome-icon">
        <img src="../icons/icon-48.png" alt="Claude">
      </div>
      <h2>Welcome to Foxhole for Claude</h2>
      <p class="welcome-intro">Browser assistant with full page control. Unlike scripts, I understand context and adapt.</p>
      <ul class="welcome-capabilities">
        <li><strong>Your Session</strong> - I act as you, using your logged-in cookies and auth</li>
        <li><strong>API Discovery</strong> - Capture network traffic, I'll reverse-engineer private APIs</li>
        <li><strong>Full DOM Access</strong> - Read, modify, and extract from page structure directly</li>
        <li><strong>Site Memory</strong> - I learn and remember selectors, quirks, and patterns per-site</li>
        <li><strong>Multi-step Chains</strong> - Complex workflows across pages with persistent context</li>
      </ul>
      <p class="welcome-tip">Try these to get started:</p>
      <div class="welcome-prompts">
        ${getWelcomePromptsHtml()}
      </div>
    </div>
  `;
}

/**
 * Attaches event listeners to prompt buttons in the welcome message.
 * When clicked, populates the user input with the button's prompt.
 *
 * @param {HTMLTextAreaElement} userInput - User input textarea element
 */
function attachPromptButtonListeners(userInput) {
  const buttons = document.querySelectorAll('.prompt-btn');
  // Fallback: get userInput directly if not passed
  const input = userInput || document.getElementById('user-input');
  console.log('[PromptButtons] Found', buttons.length, 'buttons, userInput passed:', !!userInput, 'fallback:', !!input);

  buttons.forEach((btn) => {
    // Remove old listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const prompt = newBtn.dataset.prompt;
      // Get fresh reference in case DOM changed
      const targetInput = input || document.getElementById('user-input');

      if (prompt && targetInput) {
        targetInput.value = prompt;
        targetInput.style.height = 'auto';
        targetInput.style.height = Math.min(targetInput.scrollHeight, 120) + 'px';
        targetInput.focus();
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}

/**
 * Reattaches event listeners to restored chat elements.
 * Called after restoring chat HTML from saved state to ensure
 * interactive elements (copy buttons, activity logs) work correctly.
 *
 * @param {HTMLElement} chatContainer - Chat container element
 * @param {TabManagerCallbacks} callbacks - Callback functions including handleCopyTaskClick
 */
function reattachChatEventListeners(chatContainer, callbacks) {
  const copyTaskBtns = chatContainer.querySelectorAll('.copy-task-btn');
  copyTaskBtns.forEach(btn => {
    const msgElement = btn.closest('.message');
    if (msgElement) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', () => callbacks.handleCopyTaskClick(msgElement));
    }
  });

  const activityHeaders = chatContainer.querySelectorAll('.activity-header');
  activityHeaders.forEach(header => {
    const activityLog = header.closest('.activity-log');
    if (activityLog) {
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);
      newHeader.addEventListener('click', () => {
        activityLog.classList.toggle('collapsed');
      });
    }
  });

  const activityItems = chatContainer.querySelectorAll('.activity-item');
  activityItems.forEach(item => {
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);
    newItem.addEventListener('click', (e) => {
      if (e.target.closest('.activity-item-details')) return;
      newItem.classList.toggle('expanded');
    });
  });

  // Re-attach open file button listeners (Open and Open HTML buttons)
  chatContainer.querySelectorAll('.open-file-btn').forEach(btn => {
    const downloadId = parseInt(btn.dataset.downloadId);
    const resetLabel = btn.dataset.label || '📄 Open';
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        newBtn.textContent = 'Opening...';
        newBtn.disabled = true;
        await browser.downloads.open(downloadId);
        newBtn.textContent = '✓ Opened';
        setTimeout(() => { newBtn.innerHTML = resetLabel; newBtn.disabled = false; }, 1500);
      } catch (err) {
        try {
          await browser.downloads.show(downloadId);
          newBtn.textContent = '✓ In Finder';
          setTimeout(() => { newBtn.innerHTML = resetLabel; newBtn.disabled = false; }, 1500);
        } catch (showErr) {
          newBtn.textContent = '✗ Failed';
          newBtn.style.background = '#f87171';
          setTimeout(() => {
            newBtn.innerHTML = resetLabel;
            newBtn.style.background = '';
            newBtn.disabled = false;
          }, 2000);
        }
      }
    });
  });

  // Re-attach copy URL button listeners
  chatContainer.querySelectorAll('.copy-url-btn').forEach(btn => {
    const fileUrl = btn.dataset.fileUrl;
    const filePath = btn.dataset.filePath;
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = fileUrl || `file://${filePath}`;
      try {
        await navigator.clipboard.writeText(url);
        newBtn.textContent = '✓ Copied!';
        newBtn.style.background = '#666';
        setTimeout(() => { newBtn.innerHTML = '📋 Copy URL'; newBtn.style.background = '#555'; }, 2000);
      } catch (err) {
        console.error('Copy failed:', err);
      }
    });
  });

  // Re-attach view-as-html button listeners by recreating from stored data attributes
  chatContainer.querySelectorAll('.view-html-btn').forEach(btn => {
    const markdownContent = btn.dataset.markdownContent;
    const filename = btn.dataset.filename;
    const newBtn = window.ActivityLog.createViewAsHtmlButton(markdownContent, filename);
    btn.parentNode.replaceChild(newBtn, btn);
  });
}

// Export functions for use in sidebar.js
// Note: When integrating, these will need to be imported or attached to window
// depending on the module loading strategy used
if (typeof window !== 'undefined') {
  window.TabManager = {
    initTabTracking,
    handleTabUpdated,
    handleTabActivated,
    handleTabRemoved,
    saveCurrentTabState,
    loadTabState,
    getWelcomeMessageHtml,
    getWelcomePromptsHtml,
    getPromptsDropdownHtml,
    attachPromptButtonListeners,
    reattachChatEventListeners,
    createDefaultTokenUsage
  };
}
