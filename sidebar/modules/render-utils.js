/**
 * Render utilities for the sidebar chat interface.
 * Pure functions for markdown rendering and scroll management.
 */

/**
 * Renders markdown text to HTML.
 *
 * @param {string} text - The markdown text to render
 * @returns {string} HTML string with rendered markdown
 */
function renderMarkdown(text) {
  if (!text) return '';
  return renderMarkdownContent(text);
}

/**
 * Renders markdown content using the marked library.
 * Falls back to basic HTML escaping with line breaks if marked is unavailable.
 *
 * @param {string} text - The markdown text to render
 * @returns {string} HTML string with rendered markdown
 */
function renderMarkdownContent(text) {
  if (!text) return '';

  // Use marked if available, fallback to basic rendering
  if (typeof marked !== 'undefined') {
    // Enable GFM line breaks: single \n becomes <br>
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  }

  // Fallback: basic rendering if marked isn't loaded
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/**
 * Escapes HTML special characters to prevent XSS.
 * Uses DOM-based escaping for reliability.
 *
 * @param {string} text - The text to escape
 * @returns {string} HTML-escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Scrolls the chat container to the bottom.
 * Uses requestAnimationFrame to ensure DOM has updated before scrolling.
 *
 * @param {HTMLElement} chatContainer - The chat container element to scroll
 */
function scrollToBottom(chatContainer) {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

/**
 * Forces scroll to bottom with double requestAnimationFrame.
 * Use after major content changes to ensure layout is complete.
 *
 * @param {HTMLElement} chatContainer - The chat container element to scroll
 */
function forceScrollToBottom(chatContainer) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    });
  });
}

// Export to window for MV2 compatibility
window.RenderUtils = {
  renderMarkdown,
  renderMarkdownContent,
  escapeHtml,
  scrollToBottom,
  forceScrollToBottom
};
