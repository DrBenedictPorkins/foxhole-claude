/**
 * Foxhole for Claude - Options Page
 * Manages extension settings including API key, model selection, and autonomy preferences
 */

(function() {
  'use strict';

  // Default settings
  const DEFAULT_SETTINGS = {
    apiKey: '',
    defaultModel: 'claude-haiku-4-5',
    autonomyMode: 'ask',
    highRiskTools: ['click_element', 'type_text', 'navigate', 'execute_script', 'fill_form', 'press_key', 'create_tab', 'close_tab'],
    maxTokens: 8192,
    maxToolIterations: 15,
    temperature: 0,
    networkCaptureEnabled: false
  };

  // DOM Elements
  const elements = {
    apiKey: document.getElementById('api-key'),
    toggleVisibility: document.getElementById('toggle-visibility'),
    eyeIcon: document.getElementById('eye-icon'),
    testConnection: document.getElementById('test-connection'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    defaultModel: document.getElementById('default-model'),
    autonomyMode: document.getElementById('autonomy-mode'),
    highRiskTools: document.getElementById('high-risk-tools'),
    maxTokens: document.getElementById('max-tokens'),
    maxToolIterations: document.getElementById('max-tool-iterations'),
    temperature: document.getElementById('temperature'),
    networkCapture: document.getElementById('network-capture'),
    clearHistory: document.getElementById('clear-history'),
    saveSettings: document.getElementById('save-settings'),
    resetDefaults: document.getElementById('reset-defaults'),
    saveStatus: document.getElementById('save-status'),
    saveStatusText: document.getElementById('save-status-text')
  };

  // Eye icons for visibility toggle
  const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

  /**
   * Initialize the options page
   */
  async function init() {
    await loadSettings();
    setupEventListeners();
  }

  /**
   * Load settings from storage and populate form
   */
  async function loadSettings() {
    try {
      const result = await browser.storage.local.get([
        'apiKey',
        'defaultModel',
        'autonomyMode',
        'highRiskTools',
        'maxTokens',
        'maxToolIterations',
        'temperature',
        'networkCaptureEnabled',
        'apiKeyStatus'
      ]);

      // API Key
      elements.apiKey.value = result.apiKey || DEFAULT_SETTINGS.apiKey;
      lastSavedApiKey = result.apiKey || '';

      // Update API status indicator based on stored status
      if (result.apiKeyStatus) {
        updateStatusIndicator(result.apiKeyStatus);
      } else if (result.apiKey) {
        updateStatusIndicator('untested');
      }

      // Default Model
      elements.defaultModel.value = result.defaultModel || DEFAULT_SETTINGS.defaultModel;

      // Autonomy Mode
      elements.autonomyMode.value = result.autonomyMode || DEFAULT_SETTINGS.autonomyMode;

      // High Risk Tools
      const highRiskTools = result.highRiskTools || DEFAULT_SETTINGS.highRiskTools;
      const checkboxes = elements.highRiskTools.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        checkbox.checked = highRiskTools.includes(checkbox.value);
      });

      // Max Tokens
      elements.maxTokens.value = result.maxTokens || DEFAULT_SETTINGS.maxTokens;

      // Max Tool Iterations
      elements.maxToolIterations.value = result.maxToolIterations || DEFAULT_SETTINGS.maxToolIterations;

      // Temperature (use explicit check for 0 since it's falsy)
      elements.temperature.value = result.temperature !== undefined ? result.temperature : DEFAULT_SETTINGS.temperature;

      // Network Capture
      elements.networkCapture.checked = result.networkCaptureEnabled || DEFAULT_SETTINGS.networkCaptureEnabled;

    } catch (error) {
      console.error('Failed to load settings:', error);
      showSaveStatus('error', 'Failed to load settings: ' + error.message);
    }
  }

  // Track the last saved API key to detect changes
  let lastSavedApiKey = '';

  /**
   * Save all settings to storage
   */
  async function saveSettings() {
    try {
      const newApiKey = elements.apiKey.value.trim();

      // Check if API key changed and needs validation
      if (newApiKey && newApiKey !== lastSavedApiKey) {
        // Validate the new API key first
        const isValid = await validateAndSaveApiKey(newApiKey);
        if (!isValid) {
          return; // Validation failed, don't save other settings
        }
      }

      // Gather high risk tools
      const checkboxes = elements.highRiskTools.querySelectorAll('input[type="checkbox"]:checked');
      const highRiskTools = Array.from(checkboxes).map(cb => cb.value);

      // Validate max tokens
      let maxTokens = parseInt(elements.maxTokens.value, 10);
      if (isNaN(maxTokens) || maxTokens < 256) maxTokens = 256;
      if (maxTokens > 8192) maxTokens = 8192;
      elements.maxTokens.value = maxTokens;

      // Validate max tool iterations
      let maxToolIterations = parseInt(elements.maxToolIterations.value, 10);
      if (isNaN(maxToolIterations) || maxToolIterations < 1) maxToolIterations = 1;
      if (maxToolIterations > 50) maxToolIterations = 50;
      elements.maxToolIterations.value = maxToolIterations;

      // Validate temperature (0-1 range)
      let temperature = parseFloat(elements.temperature.value);
      if (isNaN(temperature) || temperature < 0) temperature = 0;
      if (temperature > 1) temperature = 1;
      elements.temperature.value = temperature;

      const settings = {
        apiKey: newApiKey,
        defaultModel: elements.defaultModel.value,
        autonomyMode: elements.autonomyMode.value,
        highRiskTools: highRiskTools,
        maxTokens: maxTokens,
        maxToolIterations: maxToolIterations,
        temperature: temperature,
        networkCaptureEnabled: elements.networkCapture.checked
      };

      await browser.storage.local.set(settings);

      // Notify background script of settings change
      try {
        await browser.runtime.sendMessage({
          type: 'SETTINGS_UPDATED',
          settings: settings
        });
      } catch (e) {
        // Background script might not be ready, that's okay
        console.log('Could not notify background script:', e.message);
      }

      showSaveStatus('success', 'Settings saved successfully');

    } catch (error) {
      console.error('Failed to save settings:', error);
      showSaveStatus('error', 'Failed to save settings: ' + error.message);
    }
  }

  /**
   * Validate API key against Anthropic servers and save if valid
   * Returns true if valid, false if invalid
   */
  async function validateAndSaveApiKey(apiKey) {
    // Basic format check
    if (!apiKey.startsWith('sk-ant-')) {
      highlightApiKeyError('Invalid format. Anthropic API keys start with "sk-ant-"');
      return false;
    }

    updateStatusIndicator('testing');
    elements.saveSettings.disabled = true;
    elements.saveSettings.textContent = 'Validating API Key...';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (response.ok) {
        updateStatusIndicator('valid');
        await browser.storage.local.set({ apiKeyStatus: 'valid' });
        lastSavedApiKey = apiKey;
        elements.apiKey.classList.remove('error');
        elements.apiKey.classList.add('success');
        setTimeout(() => elements.apiKey.classList.remove('success'), 2000);
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        highlightApiKeyError('Invalid API key: ' + errorMessage);
        return false;
      }

    } catch (error) {
      console.error('API key validation failed:', error);
      highlightApiKeyError('Connection failed: ' + error.message);
      return false;
    } finally {
      elements.saveSettings.disabled = false;
      elements.saveSettings.textContent = 'Save Settings';
    }
  }

  /**
   * Highlight API key field as error and focus for re-entry
   */
  function highlightApiKeyError(message) {
    updateStatusIndicator('invalid');
    browser.storage.local.set({ apiKeyStatus: 'invalid' });
    showSaveStatus('error', message);

    elements.apiKey.classList.remove('success');
    elements.apiKey.classList.add('error');
    elements.apiKey.select();
    elements.apiKey.focus();
  }

  /**
   * Reset all settings to defaults
   */
  async function resetDefaults() {
    if (!confirm('Are you sure you want to reset all settings to defaults? This will not clear your API key.')) {
      return;
    }

    try {
      // Keep the API key but reset everything else
      const currentApiKey = elements.apiKey.value;

      await browser.storage.local.set({
        ...DEFAULT_SETTINGS,
        apiKey: currentApiKey
      });

      await loadSettings();
      showSaveStatus('success', 'Settings reset to defaults');

    } catch (error) {
      console.error('Failed to reset settings:', error);
      showSaveStatus('error', 'Failed to reset settings: ' + error.message);
    }
  }

  /**
   * Test the API connection
   */
  async function testConnection() {
    const apiKey = elements.apiKey.value.trim();

    if (!apiKey) {
      showSaveStatus('error', 'Please enter an API key first');
      return;
    }

    updateStatusIndicator('testing');
    elements.testConnection.disabled = true;
    elements.testConnection.textContent = 'Testing...';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (response.ok) {
        updateStatusIndicator('valid');
        await browser.storage.local.set({ apiKeyStatus: 'valid' });
        showSaveStatus('success', 'API key is valid');
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        updateStatusIndicator('invalid');
        await browser.storage.local.set({ apiKeyStatus: 'invalid' });
        showSaveStatus('error', 'Invalid API key: ' + errorMessage);
      }

    } catch (error) {
      console.error('Connection test failed:', error);
      updateStatusIndicator('invalid');
      await browser.storage.local.set({ apiKeyStatus: 'invalid' });
      showSaveStatus('error', 'Connection failed: ' + error.message);
    } finally {
      elements.testConnection.disabled = false;
      elements.testConnection.textContent = 'Test Connection';
    }
  }

  /**
   * Update the API status indicator
   */
  function updateStatusIndicator(status) {
    elements.statusIndicator.className = 'status-indicator ' + status;
    elements.statusText.className = 'status-text ' + status;

    const statusMessages = {
      untested: 'Not tested',
      testing: 'Testing...',
      valid: 'Valid',
      invalid: 'Invalid'
    };

    elements.statusText.textContent = statusMessages[status] || 'Unknown';
  }

  /**
   * Toggle API key visibility
   */
  function toggleApiKeyVisibility() {
    const isPassword = elements.apiKey.type === 'password';
    elements.apiKey.type = isPassword ? 'text' : 'password';
    elements.eyeIcon.innerHTML = isPassword ? EYE_CLOSED : EYE_OPEN;
    elements.toggleVisibility.title = isPassword ? 'Hide API key' : 'Show API key';
  }

  /**
   * Clear conversation history
   */
  async function clearConversationHistory() {
    if (!confirm('Are you sure you want to clear all conversation history? This cannot be undone.')) {
      return;
    }

    try {
      await browser.storage.local.remove(['conversationHistory', 'conversations']);

      // Notify background script
      try {
        await browser.runtime.sendMessage({
          type: 'CLEAR_CONVERSATION_HISTORY'
        });
      } catch (e) {
        console.log('Could not notify background script:', e.message);
      }

      showSaveStatus('success', 'Conversation history cleared');

    } catch (error) {
      console.error('Failed to clear history:', error);
      showSaveStatus('error', 'Failed to clear history: ' + error.message);
    }
  }

  /**
   * Show save status message
   */
  function showSaveStatus(type, message) {
    elements.saveStatus.className = 'save-status ' + type;
    elements.saveStatusText.textContent = message;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      elements.saveStatus.classList.add('hidden');
    }, 5000);
  }

  /**
   * Setup all event listeners
   */
  function setupEventListeners() {
    // API Key visibility toggle
    elements.toggleVisibility.addEventListener('click', toggleApiKeyVisibility);

    // Test connection
    elements.testConnection.addEventListener('click', testConnection);

    // Clear API status and error state when key changes
    elements.apiKey.addEventListener('input', () => {
      elements.apiKey.classList.remove('error', 'success');
      if (elements.statusIndicator.classList.contains('valid') ||
          elements.statusIndicator.classList.contains('invalid')) {
        updateStatusIndicator('untested');
        browser.storage.local.set({ apiKeyStatus: 'untested' });
      }
    });

    // Save settings
    elements.saveSettings.addEventListener('click', saveSettings);

    // Reset to defaults
    elements.resetDefaults.addEventListener('click', resetDefaults);

    // Clear conversation history
    elements.clearHistory.addEventListener('click', clearConversationHistory);

    // Auto-save on Enter key in API key field
    elements.apiKey.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveSettings();
      }
    });

    // Validate max tokens on blur
    elements.maxTokens.addEventListener('blur', () => {
      let value = parseInt(elements.maxTokens.value, 10);
      if (isNaN(value) || value < 256) value = 256;
      if (value > 8192) value = 8192;
      elements.maxTokens.value = value;
    });

    // Validate max tool iterations on blur
    elements.maxToolIterations.addEventListener('blur', () => {
      let value = parseInt(elements.maxToolIterations.value, 10);
      if (isNaN(value) || value < 1) value = 1;
      if (value > 50) value = 50;
      elements.maxToolIterations.value = value;
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
