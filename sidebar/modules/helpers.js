/**
 * Shared helper utilities for the sidebar.
 * Common patterns extracted for consistency and reduced duplication.
 */

/**
 * Shows an element by removing the 'hidden' class.
 *
 * @param {HTMLElement} el - The element to show
 */
function showModal(el) {
  el.classList.remove('hidden');
}

/**
 * Hides an element by adding the 'hidden' class.
 *
 * @param {HTMLElement} el - The element to hide
 */
function hideModal(el) {
  el.classList.add('hidden');
}

/**
 * Toggles element visibility based on a boolean condition.
 *
 * @param {HTMLElement} el - The element to toggle
 * @param {boolean} show - True to show, false to hide
 */
function toggleModal(el, show) {
  if (show) {
    showModal(el);
  } else {
    hideModal(el);
  }
}

/**
 * Sets status display with type and message.
 * Clears all existing status classes before applying new state.
 *
 * @param {HTMLElement} el - The status element
 * @param {string|null} type - Status type: 'error', 'success', 'validating', or null to clear
 * @param {string} message - Status message to display
 */
function setStatus(el, type, message) {
  el.classList.remove('visible', 'error', 'success', 'validating');
  el.textContent = message;
  if (type) {
    el.classList.add('visible', type);
  }
}

/**
 * Checks if the current tab matches the streaming tab.
 * Returns true if no streaming is active (streamingTabId is null)
 * or if the current tab is the streaming tab.
 *
 * @param {number} currentTabId - The currently active tab ID
 * @param {number|null} streamingTabId - The tab ID where streaming started, or null if not streaming
 * @returns {boolean} True if updates should be applied to the current tab
 */
function isCurrentTab(currentTabId, streamingTabId) {
  return streamingTabId === null || currentTabId === streamingTabId;
}

// Export to window for MV2 compatibility
window.Helpers = {
  showModal,
  hideModal,
  toggleModal,
  setStatus,
  isCurrentTab
};
