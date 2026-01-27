/**
 * Claude API Client for Firefox Extension
 * Streaming API client for Anthropic's Claude API with browser-specific CORS handling
 */

// Available models for the extension
const AVAILABLE_MODELS = {
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-opus-4-5': 'Opus 4.5'
};

// System prompt is loaded from external file by prompt-loader.js
// Use getSystemPrompt() to access it

/**
 * Claude API Client Class
 * Handles streaming communication with Anthropic's Claude API
 */
class ClaudeAPI {
  /**
   * Create a new ClaudeAPI instance
   * @param {string} apiKey - Anthropic API key
   * @param {string} model - Model ID (default: claude-haiku-4-5)
   * @param {number} temperature - Temperature for response generation (default: 0)
   * @param {number} maxTokens - Maximum tokens for responses (default: 8192)
   */
  constructor(apiKey, model = 'claude-haiku-4-5', temperature = 0, maxTokens = 8192) {
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.baseUrl = 'https://api.anthropic.com/v1/messages';
  }

  /**
   * Update the API key
   * @param {string} apiKey - New API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Update the model
   * @param {string} model - New model ID
   */
  setModel(model) {
    if (AVAILABLE_MODELS[model]) {
      this.model = model;
    } else {
      console.warn(`Unknown model: ${model}. Available models:`, Object.keys(AVAILABLE_MODELS));
    }
  }

  /**
   * Update the temperature
   * @param {number} temperature - Temperature value (0-1)
   */
  setTemperature(temperature) {
    const temp = parseFloat(temperature);
    if (!isNaN(temp) && temp >= 0 && temp <= 1) {
      this.temperature = temp;
    } else {
      console.warn(`Invalid temperature: ${temperature}. Must be between 0 and 1.`);
    }
  }

  /**
   * Update the max tokens
   * @param {number} maxTokens - Max tokens value (256-8192)
   */
  setMaxTokens(maxTokens) {
    const tokens = parseInt(maxTokens, 10);
    if (!isNaN(tokens) && tokens >= 256 && tokens <= 8192) {
      this.maxTokens = tokens;
    } else {
      console.warn(`Invalid maxTokens: ${maxTokens}. Must be between 256 and 8192.`);
    }
  }

  /**
   * Check if the API client is configured with a valid API key
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.startsWith('sk-ant-'));
  }

  /**
   * Stream a message to Claude and yield events
   * @param {Array} messages - Conversation messages array
   * @param {Array} tools - Tool definitions array
   * @param {string} systemPrompt - Optional custom system prompt (defaults to loaded system prompt)
   * @yields {Object} SSE events from the API
   */
  async *streamMessage(messages, tools = [], systemPrompt = null) {
    // Use loaded system prompt if none provided
    const effectiveSystemPrompt = systemPrompt ?? getSystemPrompt();
    if (!this.isConfigured()) {
      throw new Error('API key not configured. Please set your Anthropic API key in the extension settings.');
    }

    const requestBody = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true
    };

    console.log('[ClaudeAPI] Request params:', {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      toolCount: tools?.length || 0,
      messageCount: messages.length
    });

    // Debug mode: log full request payload
    if (window.debugMode) {
      console.log('[ClaudeAPI DEBUG] Full messages array:', JSON.stringify(messages, null, 2));
      console.log('[ClaudeAPI DEBUG] System prompt length:',
        Array.isArray(effectiveSystemPrompt)
          ? effectiveSystemPrompt.reduce((acc, b) => acc + (b.text?.length || 0), 0)
          : effectiveSystemPrompt?.length || 0
      );
    }

    // Add system prompt - supports both string and structured array format
    // Structured format enables prompt caching: [{ type: "text", text: "...", cache_control: {...} }]
    if (effectiveSystemPrompt) {
      requestBody.system = effectiveSystemPrompt;
    }

    // Add messages
    requestBody.messages = messages;

    // Add tools with cache_control on the last tool for prompt caching
    // This caches the entire tools array since cache applies to everything before the marker
    if (tools && tools.length > 0) {
      requestBody.tools = tools.map((tool, index) => {
        if (index === tools.length - 1) {
          // Add cache_control to last tool to cache all tools
          return { ...tool, cache_control: { type: 'ephemeral' } };
        }
        return tool;
      });
    }

    let response;
    let lastError;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(requestBody)
        });
        break; // Success, exit retry loop
      } catch (networkError) {
        lastError = networkError;
        console.warn(`[ClaudeAPI] Network error (attempt ${attempt + 1}/${maxRetries + 1}):`, networkError.message);
        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff: 1s, 2s)
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    if (!response) {
      throw new Error(`Network error after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}. Please check your internet connection.`);
    }

    // Handle non-200 responses
    if (!response.ok) {
      let errorMessage = `API error: ${response.status} ${response.statusText}`;

      try {
        const errorBody = await response.json();
        if (errorBody.error) {
          errorMessage = `API error: ${errorBody.error.type || response.status} - ${errorBody.error.message || response.statusText}`;
        }
      } catch (e) {
        // Could not parse error body, use default message
      }

      // Provide helpful messages for common errors
      switch (response.status) {
        case 401:
          throw new Error('Invalid API key. Please check your Anthropic API key in the extension settings.');
        case 403:
          throw new Error('Access forbidden. Your API key may not have access to this model.');
        case 429:
          throw new Error('Rate limit exceeded. Please wait a moment before sending another message.');
        case 500:
        case 502:
        case 503:
          throw new Error('Anthropic API is temporarily unavailable. Please try again in a moment.');
        default:
          throw new Error(errorMessage);
      }
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data && data !== '[DONE]') {
                  try {
                    yield JSON.parse(data);
                  } catch (e) {
                    console.warn('Failed to parse SSE data:', data);
                  }
                }
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Skip empty lines and event type lines
          if (!trimmedLine || trimmedLine.startsWith('event:')) {
            continue;
          }

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);

            // Check for stream termination
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch (e) {
              // Skip malformed JSON, might be partial data
              console.warn('Failed to parse SSE data:', data);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Send a non-streaming message (for simpler use cases)
   * @param {Array} messages - Conversation messages array
   * @param {Array} tools - Tool definitions array
   * @param {string} systemPrompt - Optional custom system prompt
   * @returns {Object} Complete API response
   */
  async sendMessage(messages, tools = [], systemPrompt = null) {
    const effectiveSystemPrompt = systemPrompt ?? getSystemPrompt();

    if (!this.isConfigured()) {
      throw new Error('API key not configured. Please set your Anthropic API key in the extension settings.');
    }

    const requestBody = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature
    };

    if (effectiveSystemPrompt) {
      requestBody.system = effectiveSystemPrompt;
    }

    requestBody.messages = messages;

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error) {
          errorMessage = `${errorBody.error.type}: ${errorBody.error.message}`;
        }
      } catch (e) {}
      throw new Error(errorMessage);
    }

    return await response.json();
  }
}

// Export for use in other background scripts
// In Firefox MV2, scripts loaded via manifest share the global scope
// Note: SYSTEM_PROMPT is provided by prompt-loader.js via getSystemPrompt()
if (typeof window !== 'undefined') {
  window.ClaudeAPI = ClaudeAPI;
  window.AVAILABLE_MODELS = AVAILABLE_MODELS;
}
