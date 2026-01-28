/**
 * Context Manager - Automatic conversation compression
 *
 * Strategies:
 * 1. Sliding window: Max message pairs
 * 2. Token threshold: Trigger compression at limit
 * 3. Temporal decay: Old = summary, Recent = full
 */

const ContextManager = (function() {
  // Configuration
  const CONFIG = {
    MAX_MESSAGE_PAIRS: 10,           // Hard limit on conversation length
    TOKEN_THRESHOLD: 25000,          // Trigger compression at 25k tokens
    KEEP_RECENT_PAIRS: 4,            // Keep last 4 exchanges intact
    SUMMARY_TRIGGER_PAIRS: 6,        // Start summarizing after 6 pairs
  };

  /**
   * Check if context needs compression
   * @param {number} totalTokens - Current total input tokens
   * @param {Array} conversation - Current conversation array
   * @returns {Object} { needsCompression: boolean, reason: string }
   */
  function checkCompressionNeeded(totalTokens, conversation) {
    const messagePairs = Math.floor(conversation.length / 2);

    // Check token threshold
    if (totalTokens > CONFIG.TOKEN_THRESHOLD) {
      return {
        needsCompression: true,
        reason: `Token limit exceeded (${Math.round(totalTokens/1000)}k > ${CONFIG.TOKEN_THRESHOLD/1000}k)`
      };
    }

    // Check message count
    if (messagePairs > CONFIG.MAX_MESSAGE_PAIRS) {
      return {
        needsCompression: true,
        reason: `Message limit exceeded (${messagePairs} > ${CONFIG.MAX_MESSAGE_PAIRS} pairs)`
      };
    }

    return { needsCompression: false, reason: null };
  }

  /**
   * Compress conversation by summarizing older messages
   * @param {Array} conversation - Full conversation array
   * @param {Function} summarizeCallback - Async function to call Claude for summary
   * @returns {Promise<Array>} Compressed conversation
   */
  async function compressConversation(conversation, summarizeCallback) {
    const messagePairs = Math.floor(conversation.length / 2);

    if (messagePairs <= CONFIG.KEEP_RECENT_PAIRS) {
      console.log('[ContextManager] Not enough messages to compress');
      return conversation;
    }

    // Split: older messages to summarize, recent to keep intact
    const keepCount = CONFIG.KEEP_RECENT_PAIRS * 2; // pairs -> messages
    const toSummarize = conversation.slice(0, -keepCount);
    const toKeep = conversation.slice(-keepCount);

    console.log(`[ContextManager] Compressing ${toSummarize.length} messages, keeping ${toKeep.length}`);

    // Build summary request
    const summaryText = buildSummaryText(toSummarize);

    try {
      // Get summary from Claude (via background)
      const summary = await summarizeCallback(summaryText);

      // Create compressed conversation
      const compressedConversation = [
        {
          role: 'user',
          content: '[CONVERSATION HISTORY SUMMARY]'
        },
        {
          role: 'assistant',
          content: summary
        },
        ...toKeep
      ];

      console.log(`[ContextManager] Compressed: ${conversation.length} → ${compressedConversation.length} messages`);
      return compressedConversation;

    } catch (error) {
      console.error('[ContextManager] Compression failed:', error);
      // Fallback: just apply sliding window
      return applySlidingWindow(conversation);
    }
  }

  /**
   * Apply hard sliding window - just drop oldest messages
   * @param {Array} conversation - Conversation array
   * @returns {Array} Trimmed conversation
   */
  function applySlidingWindow(conversation) {
    const maxMessages = CONFIG.MAX_MESSAGE_PAIRS * 2;
    if (conversation.length <= maxMessages) {
      return conversation;
    }

    const trimmed = conversation.slice(-maxMessages);
    console.log(`[ContextManager] Sliding window: ${conversation.length} → ${trimmed.length} messages`);
    return trimmed;
  }

  /**
   * Build text for summarization request
   * @param {Array} messages - Messages to summarize
   * @returns {string} Formatted text for summary
   */
  function buildSummaryText(messages) {
    let text = 'Summarize this conversation history in 2-3 sentences, noting key actions taken and results:\n\n';

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let content = '';

      if (typeof msg.content === 'string') {
        content = msg.content.slice(0, 500); // Truncate long messages
      } else if (Array.isArray(msg.content)) {
        // Handle structured content (tool results, etc.)
        for (const block of msg.content) {
          if (block.type === 'text') {
            content += block.text?.slice(0, 200) || '';
          } else if (block.type === 'tool_use') {
            content += `[Tool: ${block.name}] `;
          } else if (block.type === 'tool_result') {
            content += '[Tool result] ';
          }
        }
      }

      if (content.length > 500) {
        content = content.slice(0, 500) + '...';
      }

      text += `${role}: ${content}\n\n`;
    }

    return text;
  }

  /**
   * Get compression status message for UI
   * @param {number} totalTokens
   * @param {number} messageCount
   * @returns {string|null} Status message or null if healthy
   */
  function getStatusMessage(totalTokens, messageCount) {
    const tokenPercent = Math.round((totalTokens / CONFIG.TOKEN_THRESHOLD) * 100);
    const pairPercent = Math.round((messageCount / 2 / CONFIG.MAX_MESSAGE_PAIRS) * 100);

    if (tokenPercent > 90 || pairPercent > 90) {
      return `Context ${Math.max(tokenPercent, pairPercent)}% full - will compress soon`;
    }
    if (tokenPercent > 70 || pairPercent > 70) {
      return `Context ${Math.max(tokenPercent, pairPercent)}% used`;
    }
    return null;
  }

  // Public API
  return {
    CONFIG,
    checkCompressionNeeded,
    compressConversation,
    applySlidingWindow,
    getStatusMessage
  };
})();

// Export for use
window.ContextManager = ContextManager;
