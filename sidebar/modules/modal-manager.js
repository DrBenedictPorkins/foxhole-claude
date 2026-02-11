/**
 * Modal and Dropdown Manager
 *
 * Handles all modal dialogs, dropdown menus, and related UI interactions
 * for the sidebar. Extracted from sidebar.js for better organization.
 *
 * Dependencies:
 * - DOM elements passed via init() config
 * - State variables accessed via config.getState() / config.setState()
 * - Helper functions from sidebar.js (scrollToBottom, escapeHtml, etc.)
 */

// ============================================================================
// Module State
// ============================================================================

/** @type {Object|null} Pending tool confirmation data */
let pendingConfirmation = null;

/** @type {Object|null} Configuration object with DOM elements and callbacks */
let config = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes the modal manager with required DOM elements and callbacks.
 *
 * @param {Object} cfg - Configuration object
 * @param {Object} cfg.elements - DOM element references
 * @param {HTMLElement} cfg.elements.clearConfirmModal - Clear confirmation modal
 * @param {HTMLElement} cfg.elements.confirmModal - Tool confirmation modal
 * @param {HTMLElement} cfg.elements.confirmAction - Confirmation action text element
 * @param {HTMLElement} cfg.elements.confirmParams - Confirmation params display element
 * @param {HTMLElement} cfg.elements.confirmCancel - Confirmation cancel button
 * @param {HTMLElement} cfg.elements.confirmApprove - Confirmation approve button
 * @param {HTMLElement} cfg.elements.apiKeyModal - API key modal
 * @param {HTMLElement} cfg.elements.apiKeyInput - API key input field
 * @param {HTMLElement} cfg.elements.dropdownMenu - Main dropdown menu
 * @param {HTMLElement} cfg.elements.menuBtn - Menu button
 * @param {HTMLElement} cfg.elements.autonomyMenu - Autonomy dropdown menu
 * @param {HTMLElement} cfg.elements.autonomyBtn - Autonomy button
 * @param {HTMLElement} cfg.elements.autonomyLabel - Autonomy label text
 * @param {NodeList} cfg.elements.autonomyOptions - Autonomy option buttons
 * @param {HTMLElement} cfg.elements.chatContainer - Chat messages container
 * @param {HTMLElement} cfg.elements.userInput - User input textarea
 * @param {HTMLElement} cfg.elements.imagePreviewContainer - Image preview container
 * @param {HTMLElement} [cfg.elements.attachMenu] - Attachment menu (optional)
 * @param {Object} cfg.callbacks - Callback functions
 * @param {Function} cfg.callbacks.getState - Returns current state object
 * @param {Function} cfg.callbacks.setState - Updates state
 * @param {Function} cfg.callbacks.scrollToBottom - Scrolls chat to bottom
 * @param {Function} cfg.callbacks.getWelcomeMessageHtml - Returns welcome HTML
 * @param {Function} cfg.callbacks.attachPromptButtonListeners - Attaches prompt listeners
 * @param {Function} cfg.callbacks.clearPendingImage - Clears pending image
 * @param {Function} cfg.callbacks.updateTokenUsage - Updates token display
 * @param {Function} cfg.callbacks.handleInputChange - Handles input state change
 * @param {Function} cfg.callbacks.addSystemMessage - Adds system message to chat
 * @param {Function} cfg.callbacks.addAssistantMessage - Adds assistant message to chat
 * @param {Function} cfg.callbacks.saveCurrentTabState - Saves current tab state
 */
function init(cfg) {
  config = cfg;
}

// ============================================================================
// Clear Chat Modal
// ============================================================================

/**
 * Shows the clear chat confirmation modal.
 */
function showClearConfirmModal() {
  config.elements.clearConfirmModal.classList.remove('hidden');
}

/**
 * Hides the clear chat confirmation modal.
 */
function hideClearConfirmModal() {
  config.elements.clearConfirmModal.classList.add('hidden');
}

/**
 * Handles the confirmed clear chat action.
 * Clears conversation, resets token usage, and restores welcome message.
 */
function handleClearChatConfirmed() {
  const state = config.callbacks.getState();

  // Reset conversation state (including lastTurnTokens for proper display)
  config.callbacks.setState({
    conversation: [],
    tokenUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    lastTurnTokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
  });

  config.callbacks.refreshTokenDisplay();
  config.elements.chatContainer.innerHTML = config.callbacks.getWelcomeMessageHtml();
  config.callbacks.attachPromptButtonListeners();

  // Clear any pending image
  config.callbacks.clearPendingImage();

  // Update the stored state for this tab
  if (state.currentTabId) {
    const tabConversations = state.tabConversations;
    tabConversations.set(state.currentTabId, {
      conversation: [],
      tokenUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      lastTurnTokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      chatHtml: null
    });
  }

  hideClearConfirmModal();
}

// ============================================================================
// Tool Confirmation Modal
// ============================================================================

/**
 * Renders tool input parameters into the confirmation modal container.
 * Multi-line string values (e.g. code) get their own code block with real line breaks.
 * Short values render inline as label: value pairs.
 */
function renderConfirmParams(container, toolInput) {
  container.innerHTML = '';
  const entries = Object.entries(toolInput);

  for (const [key, value] of entries) {
    const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const isMultiLine = str.includes('\n');

    const block = document.createElement('div');
    block.className = 'confirm-param-block';

    const label = document.createElement('span');
    label.className = 'confirm-param-label';
    label.textContent = key;
    block.appendChild(label);

    if (isMultiLine) {
      const pre = document.createElement('pre');
      pre.className = 'confirm-param-code';
      pre.textContent = str;
      block.appendChild(pre);
    } else {
      const val = document.createElement('span');
      val.className = 'confirm-param-value';
      val.textContent = str;
      block.appendChild(val);
    }

    container.appendChild(block);
  }
}

/**
 * Adds a "View full" link to the params container that opens a formatted
 * read-only page in a new tab. Only shown when payload exceeds a threshold.
 */
function renderViewFullLink(container, toolName, toolInput) {
  const json = JSON.stringify(toolInput, null, 2);
  if (json.length < 200) return;

  const link = document.createElement('button');
  link.className = 'confirm-view-full';
  link.textContent = 'View full payload';
  link.addEventListener('click', () => openPayloadTab(toolName, toolInput));
  container.appendChild(link);
}

/**
 * Opens a new tab with the full tool payload rendered as a formatted read-only page.
 */
function openPayloadTab(toolName, toolInput) {
  const entries = Object.entries(toolInput);
  const paramsHtml = entries.map(([key, value]) => {
    const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="param"><span class="label">${key}</span><pre>${escaped}</pre></div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${toolName} — Foxhole Payload</title>
<style>
  body { background: #1a1a1a; color: #d4d4d4; font-family: -apple-system, sans-serif; margin: 0; padding: 32px; }
  h1 { font-size: 18px; color: #fff; margin: 0 0 24px; }
  h1 span { color: #c9a227; }
  .param { margin-bottom: 16px; }
  .label { display: block; font-size: 11px; font-weight: 600; color: #c9a227; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  pre { margin: 0; padding: 12px; background: rgba(0,0,0,0.4); border-radius: 6px; font-family: 'SF Mono', Monaco, 'Courier New', monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
</style></head><body>
<h1><span>${toolName}</span> payload</h1>
${paramsHtml}
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  browser.windows.create({ url, type: 'popup', width: 720, height: 600 });
}

/**
 * Shows the tool confirmation modal for high-risk tool execution.
 *
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} toolInput - Input parameters for the tool
 * @param {string} toolId - Unique identifier for the tool call
 */
function showConfirmationModal(toolName, toolInput, toolId) {
  pendingConfirmation = { toolName, toolInput, toolId };

  resetSwitchModeUI();

  config.elements.confirmAction.textContent = `Claude wants to execute: ${toolName}`;
  renderConfirmParams(config.elements.confirmParams, toolInput);
  renderViewFullLink(config.elements.confirmParams, toolName, toolInput);
  config.elements.confirmModal.classList.remove('hidden');
}

/**
 * Resets the "Skip all confirmations" two-click UI back to its initial state.
 * Called when showing a new confirmation modal or when the user clicks "Go back".
 */
function resetSwitchModeUI() {
  const modal = config.elements.confirmModal;

  // Remove warning banner from any previous stage-2 state
  const existingWarning = modal.querySelector('.confirm-modal-warning');
  if (existingWarning) existingWarning.remove();

  // Reset switch button text and class
  const switchBtn = modal.querySelector('#confirm-switch-mode');
  if (switchBtn) {
    switchBtn.textContent = 'Skip all confirmations';
    switchBtn.className = 'confirm-mode-switch-link';
  }

  // Reset switch container class
  const switchContainer = modal.querySelector('.confirm-mode-switch');
  if (switchContainer) switchContainer.className = 'confirm-mode-switch';

  // Restore Cancel/Approve visibility
  config.elements.confirmCancel.style.display = '';
  config.elements.confirmApprove.style.display = '';

  // Remove any leftover go-back button
  const goBackBtn = modal.querySelector('.confirm-mode-goback');
  if (goBackBtn) goBackBtn.remove();
}

/**
 * Handles cancellation of tool confirmation.
 * Sends rejection message to background script.
 */
function handleConfirmCancel() {
  if (pendingConfirmation) {
    browser.runtime.sendMessage({
      type: 'TOOL_CONFIRMATION',
      toolId: pendingConfirmation.toolId,
      approved: false
    });
    pendingConfirmation = null;
  }
  config.elements.confirmModal.classList.add('hidden');
}

/**
 * Handles approval of tool confirmation.
 * Sends approval message to background script.
 */
function handleConfirmApprove() {
  if (pendingConfirmation) {
    browser.runtime.sendMessage({
      type: 'TOOL_CONFIRMATION',
      toolId: pendingConfirmation.toolId,
      approved: true
    });
    pendingConfirmation = null;
  }
  config.elements.confirmModal.classList.add('hidden');
}

/**
 * Handles the "Skip all confirmations" link in the confirmation modal.
 * Two-click flow: first click shows warning, second click executes the switch.
 */
function handleConfirmSwitchMode() {
  const modal = config.elements.confirmModal;
  const switchBtn = modal.querySelector('#confirm-switch-mode');
  if (!switchBtn) return;

  const modalBody = modal.querySelector('.modal-body');
  const existingWarning = modalBody.querySelector('.confirm-modal-warning');

  // First click: show warning, hide Cancel/Approve, promote switch to main action
  if (!existingWarning) {
    const warning = document.createElement('div');
    warning.className = 'confirm-modal-warning';
    warning.textContent = 'This will approve this action and all future actions without any confirmation. Claude will click, type, navigate, and execute scripts freely. You can re-enable confirmations anytime from the toolbar.';
    modalBody.insertBefore(warning, modalBody.firstChild);

    // Hide Cancel/Approve
    config.elements.confirmCancel.style.display = 'none';
    config.elements.confirmApprove.style.display = 'none';

    // Promote switch button to prominent confirm action
    switchBtn.textContent = 'Confirm: skip all confirmations';
    switchBtn.className = 'confirm-mode-switch-link confirm-mode-switch-primary';
    const switchContainer = modal.querySelector('.confirm-mode-switch');
    if (switchContainer) {
      switchContainer.className = 'confirm-mode-switch confirm-mode-switch-stage2';

      // Add go-back link
      const goBack = document.createElement('button');
      goBack.className = 'confirm-mode-goback';
      goBack.textContent = 'Go back';
      goBack.addEventListener('click', resetSwitchModeUI);
      switchContainer.appendChild(goBack);
    }
    return;
  }

  // Second click: switch mode, approve, and close
  const state = config.callbacks.getState();

  config.callbacks.setState({ autonomyMode: 'auto' });
  updateAutonomyUI();

  if (state.currentTabId) {
    const tabState = state.tabConversations.get(state.currentTabId);
    if (tabState) {
      tabState.autonomyMode = 'auto';
    }
  }

  browser.runtime.sendMessage({
    type: 'SET_AUTONOMY_MODE',
    mode: 'auto',
    tabId: state.currentTabId
  });

  // Approve the pending tool
  handleConfirmApprove();
}

// ============================================================================
// API Key Modal
// ============================================================================

/**
 * Shows the API key configuration modal.
 */
function showApiKeyModal() {
  config.elements.apiKeyModal.classList.remove('hidden');
  config.elements.apiKeyInput.focus();
}

/**
 * Handles saving and validating the API key.
 * Validates format, tests against Anthropic API, and stores if valid.
 */
async function handleApiKeySave() {
  const apiKey = config.elements.apiKeyInput.value.trim();
  const statusEl = document.getElementById('api-key-status');
  const saveBtn = document.getElementById('api-key-save');

  // Reset state
  config.elements.apiKeyInput.classList.remove('error', 'success');
  statusEl.classList.remove('visible', 'error', 'success', 'validating');

  // Basic format validation
  if (!apiKey) {
    showApiKeyError('Please enter an API key');
    return;
  }

  if (!apiKey.startsWith('sk-ant-')) {
    showApiKeyError('Invalid format. Anthropic API keys start with "sk-ant-"');
    return;
  }

  // Show validating state
  statusEl.textContent = 'Validating API key...';
  statusEl.classList.add('visible', 'validating');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Validating...';

  try {
    // Validate against Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    });

    if (response.ok) {
      // Success - save the key
      await browser.storage.local.set({ apiKey, apiKeyStatus: 'valid' });
      config.callbacks.setState({ apiKeyConfigured: true });

      // Show success briefly
      config.elements.apiKeyInput.classList.add('success');
      statusEl.textContent = 'API key validated successfully!';
      statusEl.classList.remove('validating');
      statusEl.classList.add('success');

      // Notify background script
      browser.runtime.sendMessage({ type: 'API_KEY_UPDATED' });

      // Close modal after brief delay
      setTimeout(() => {
        config.elements.apiKeyModal.classList.add('hidden');
        config.elements.apiKeyInput.value = '';
        config.elements.apiKeyInput.classList.remove('success');
        statusEl.classList.remove('visible', 'success');
      }, 1000);

    } else {
      // API returned an error
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
      showApiKeyError(`Invalid API key: ${errorMessage}`);
    }

  } catch (error) {
    console.error('API key validation failed:', error);
    showApiKeyError(`Connection failed: ${error.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save API Key';
  }
}

/**
 * Shows an API key validation error and focuses input for retry.
 *
 * @param {string} message - Error message to display
 */
function showApiKeyError(message) {
  const statusEl = document.getElementById('api-key-status');

  config.elements.apiKeyInput.classList.remove('success', 'validating');
  config.elements.apiKeyInput.classList.add('error');

  statusEl.textContent = message;
  statusEl.classList.remove('validating', 'success');
  statusEl.classList.add('visible', 'error');

  // Select all text and focus for easy re-paste
  config.elements.apiKeyInput.select();
  config.elements.apiKeyInput.focus();
}

// ============================================================================
// Autonomy Dropdown
// ============================================================================

/**
 * Toggles the main dropdown menu visibility.
 *
 * @param {Event} e - Click event
 */
function toggleDropdownMenu(e) {
  e.stopPropagation();
  config.elements.dropdownMenu.classList.toggle('hidden');
  config.elements.autonomyMenu.classList.add('hidden');
  if (config.elements.attachMenu) {
    config.elements.attachMenu.classList.add('hidden');
  }
}

/**
 * Toggles the autonomy mode dropdown menu.
 *
 * @param {Event} e - Click event
 */
function toggleAutonomyMenu(e) {
  e.stopPropagation();
  config.elements.autonomyMenu.classList.toggle('hidden');
  config.elements.autonomyBtn.classList.toggle('open');
  config.elements.dropdownMenu.classList.add('hidden');
  if (config.elements.attachMenu) {
    config.elements.attachMenu.classList.add('hidden');
  }
}

/**
 * Handles autonomy mode change from dropdown selection.
 * Updates UI, saves to tab state, and notifies background.
 *
 * @param {Event} e - Click event from autonomy option
 */
async function handleAutonomyChange(e) {
  const option = e.currentTarget;
  const mode = option.dataset.mode;
  const state = config.callbacks.getState();

  config.callbacks.setState({ autonomyMode: mode });
  updateAutonomyUI();

  // Save to current tab's state (not global storage)
  if (state.currentTabId) {
    const tabState = state.tabConversations.get(state.currentTabId);
    if (tabState) {
      tabState.autonomyMode = mode;
    }
  }

  // Notify background script of the change for this tab
  browser.runtime.sendMessage({
    type: 'SET_AUTONOMY_MODE',
    mode: mode,
    tabId: state.currentTabId
  });

  // Hide menu
  config.elements.autonomyMenu.classList.add('hidden');
  config.elements.autonomyBtn.classList.remove('open');
}

/**
 * Updates the autonomy UI to reflect current mode.
 * Updates button label, selected option, and risk banner visibility.
 */
function updateAutonomyUI() {
  // Guard: config may not be initialized yet if called early
  if (!config) return;

  const state = config.callbacks.getState();
  const autonomyMode = state.autonomyMode;

  // Update button label
  config.elements.autonomyLabel.textContent = autonomyMode === 'ask'
    ? 'Confirm risky actions'
    : 'Skip all confirmations';

  // Update selected option
  config.elements.autonomyOptions.forEach(option => {
    if (option.dataset.mode === autonomyMode) {
      option.classList.add('selected');
    } else {
      option.classList.remove('selected');
    }
  });

  // Show/hide risk banner based on mode
  const riskBanner = document.getElementById('risk-banner');
  if (riskBanner) {
    if (autonomyMode === 'auto') {
      riskBanner.classList.remove('hidden');
    } else {
      riskBanner.classList.add('hidden');
    }
  }
}

// ============================================================================
// Attachment / Image Handling
// ============================================================================

/**
 * Handles attach button click - opens file picker for images.
 */
function handleAttachClick() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      await processImageFile(file);
    }
  };
  input.click();
}

/**
 * Handles paste event to detect and process clipboard images.
 *
 * @param {ClipboardEvent} e - Paste event
 */
async function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        await processImageFile(file);
      }
      return;
    }
  }
}

/**
 * Processes an image file from paste or file picker.
 * Converts to base64 and stores as pending image for next message.
 *
 * @param {File} file - Image file to process
 */
async function processImageFile(file) {
  try {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64Match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);

      if (base64Match) {
        const mediaType = base64Match[1];
        const base64Data = base64Match[2];

        // Add to pending images array
        const state = config.callbacks.getState();
        const images = [...(state.pendingImages || [])];
        images.push({ mediaType, base64: base64Data });
        config.callbacks.setState({ pendingImages: images });

        // Re-render previews and update send button
        if (config.callbacks.renderImagePreviews) {
          config.callbacks.renderImagePreviews();
        }
        config.callbacks.handleInputChange();

        // Focus input for user to add optional text
        config.elements.userInput.focus();
      }
    };
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('Failed to process image:', error);
  }
}

/**
 * Handles remove image button click.
 */
function handleRemoveImage() {
  clearPendingImage();
}

/**
 * Clears pending image and hides preview.
 */
function clearPendingImage() {
  config.callbacks.setState({ pendingImages: [] });
  if (config.callbacks.renderImagePreviews) {
    config.callbacks.renderImagePreviews();
  }
  config.callbacks.handleInputChange();
}

// ============================================================================
// Outside Click Handler
// ============================================================================

/**
 * Handles clicks outside dropdowns to close them.
 *
 * @param {Event} e - Click event
 */
function handleOutsideClick(e) {
  if (!config.elements.dropdownMenu.contains(e.target) &&
      !config.elements.menuBtn.contains(e.target)) {
    config.elements.dropdownMenu.classList.add('hidden');
  }

  if (!config.elements.autonomyMenu.contains(e.target) &&
      !config.elements.autonomyBtn.contains(e.target)) {
    config.elements.autonomyMenu.classList.add('hidden');
    config.elements.autonomyBtn.classList.remove('open');
  }
}

// ============================================================================
// Export for MV2 Compatibility
// ============================================================================

/**
 * Modal Manager - handles all modal and dropdown interactions
 * @namespace
 */
window.ModalManager = {
  // Initialization
  init,

  // Clear chat modal
  clearChat: {
    show: showClearConfirmModal,
    hide: hideClearConfirmModal,
    handleConfirm: handleClearChatConfirmed
  },

  // Tool confirmation modal
  confirm: {
    show: showConfirmationModal,
    cancel: handleConfirmCancel,
    approve: handleConfirmApprove,
    switchMode: handleConfirmSwitchMode
  },

  // API key modal
  apiKey: {
    show: showApiKeyModal,
    save: handleApiKeySave,
    showError: showApiKeyError
  },

  // Autonomy dropdown
  autonomy: {
    toggleDropdown: toggleDropdownMenu,
    toggleMenu: toggleAutonomyMenu,
    handleChange: handleAutonomyChange,
    updateUI: updateAutonomyUI
  },

  // Attachment / image handling
  attach: {
    handleClick: handleAttachClick,
    handlePaste: handlePaste,
    processImage: processImageFile,
    remove: handleRemoveImage,
    clear: clearPendingImage
  },

  // Utility
  handleOutsideClick
};
