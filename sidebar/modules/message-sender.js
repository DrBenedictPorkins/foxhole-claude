/**
 * Message Sender Module
 * Handles outbound messaging functions for sending messages to Claude via the background script.
 * Manages input handling, streaming state, and message sending flow.
 */

/**
 * Creates the MessageSender module with all outbound messaging functions.
 *
 * @param {Object} deps - Dependencies injected from the main sidebar
 * @param {Object} deps.state - Shared state object containing conversation, streaming state, etc.
 * @param {Object} deps.elements - DOM elements (userInput, sendBtn, stopBtn, chatContainer)
 * @param {Object} deps.callbacks - Callback functions for UI updates
 * @returns {Object} MessageSender API
 */
function createMessageSender(deps) {
  const { state, elements, callbacks } = deps;

  /**
   * Handles Enter key press to send message.
   * Shift+Enter creates a new line instead.
   *
   * @param {KeyboardEvent} e - The keyboard event
   */
  function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  /**
   * Updates send button state based on input content.
   * Disables send when empty (unless image attached) or when streaming.
   */
  function handleInputChange() {
    const hasText = elements.userInput.value.trim().length > 0;
    const hasImage = state.pendingImage !== null;
    elements.sendBtn.disabled = (!hasText && !hasImage) || state.isStreaming;
  }

  /**
   * Main send flow - builds message content and initiates send to background.
   * Handles text-only, image-only, and text+image messages.
   */
  async function handleSendMessage() {
    const text = elements.userInput.value.trim();
    const hasImage = state.pendingImage !== null;

    // Need either text or image to send
    if ((!text && !hasImage) || state.isStreaming) return;

    if (!state.apiKeyConfigured) {
      callbacks.showApiKeyModal();
      return;
    }

    // Clear input and image preview
    elements.userInput.value = '';
    elements.userInput.style.height = 'auto';
    elements.sendBtn.disabled = true;

    // Capture and clear pending image before async operations
    const imageToSend = state.pendingImage;
    if (hasImage) {
      callbacks.clearPendingImage();
    }

    // Remove welcome message if present
    const welcomeMsg = elements.chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    // Build message content
    let messageContent;
    let displayText = text;

    if (imageToSend) {
      // Build content array with image and optional text
      messageContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageToSend.mediaType,
            data: imageToSend.base64
          }
        }
      ];
      if (text) {
        messageContent.push({ type: 'text', text: text });
      }
      displayText = text || '[Image]';
    } else {
      messageContent = text;
    }

    // Add user message to UI (show image if present)
    callbacks.addMessageToUI('user', displayText, imageToSend);

    // Add to conversation
    state.conversation.push({ role: 'user', content: messageContent });

    // Send to background script
    await sendToBackground();
  }

  /**
   * Sends conversation to background script for Claude API call.
   * Sets up streaming state and creates placeholder message element.
   *
   * STATELESS APPROACH: Only sends the current user message, not full history.
   * Claude can call request_history tool if it needs prior context.
   */
  async function sendToBackground() {
    state.isStreaming = true;
    state.streamingTabId = state.currentTabId;
    elements.sendBtn.classList.add('hidden');
    elements.stopBtn.classList.remove('hidden');

    // Create assistant message element for streaming
    const msgElement = callbacks.createMessageElement('assistant', '');
    elements.chatContainer.appendChild(msgElement);
    callbacks.scrollToBottom();

    const contentElement = msgElement.querySelector('.message-content');
    contentElement.innerHTML = '<span class="streaming-cursor"></span>';

    // STATELESS: Only send the current (last) user message, not full history
    // Background stores task history that Claude can request via request_history tool
    const lastUserMessage = state.conversation[state.conversation.length - 1];
    const statelessConversation = lastUserMessage ? [lastUserMessage] : [];

    try {
      const response = await browser.runtime.sendMessage({
        type: 'CHAT_MESSAGE',
        conversation: statelessConversation,
        model: state.selectedModel,
        windowId: state.currentWindowId,
        autonomyMode: state.autonomyMode
      });

      if (response.error) {
        throw new Error(response.error);
      }

      // Response will be streamed via message handler
    } catch (error) {
      console.error('Failed to send message:', error);
      contentElement.innerHTML = '';
      callbacks.addErrorToMessage(contentElement, error.message);
      resetStreamingState();
    }
  }

  /**
   * Resets streaming state and restores UI to ready state.
   * Called after stream ends (success or error) or user stops generation.
   */
  function resetStreamingState() {
    state.isStreaming = false;
    state.streamingTabId = null;
    state.pendingTabSwitch = null;
    elements.sendBtn.classList.remove('hidden');
    elements.stopBtn.classList.add('hidden');
    elements.sendBtn.disabled = elements.userInput.value.trim().length === 0;
  }

  /**
   * Handles stop button click to cancel current generation.
   * Sends cancel message to background and updates UI.
   */
  async function handleStopGeneration() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await browser.runtime.sendMessage({
        type: 'CANCEL_STREAM',
        tabId: tab.id
      });
      resetStreamingState();

      // Add a note to the last message that it was stopped
      const lastMsg = elements.chatContainer.querySelector('.message.assistant:last-child .message-content');
      if (lastMsg) {
        lastMsg.innerHTML += '<div class="stopped-notice">[Stopped by user]</div>';
      }
    } catch (error) {
      console.error('Failed to stop generation:', error);
    }
  }

  return {
    handleInputKeydown,
    handleInputChange,
    handleSendMessage,
    sendToBackground,
    resetStreamingState,
    handleStopGeneration
  };
}

// Export to window for MV2 compatibility
window.MessageSender = { create: createMessageSender };
