/**
 * Composio Reddit Integration
 * Uses Composio's MCP consumer endpoint because the dashboard "Sessions API Key"
 * authenticates MCP clients, not the SDK's project API.
 */

const crypto = require('crypto');

class ComposioRedditService {
  constructor() {
    this.apiKey = process.env.COMPOSIO_API_KEY;
    this.entityId = process.env.COMPOSIO_ENTITY_ID || 'godmode-user';
    this.mcpUrl = process.env.COMPOSIO_MCP_URL || 'https://connect.composio.dev/mcp';
    this.initialized = false;
    this.flairCache = new Map();
  }

  async initialize() {
    if (this.initialized) return;

    if (!this.apiKey) {
      console.warn('[Composio] API key not configured - Reddit integration disabled');
      return;
    }

    try {
      this.initialized = true;
      console.log('[Composio] Reddit MCP integration initialized');
      console.log(`[Composio] Using MCP consumer key for entity/user: ${this.entityId}`);
    } catch (err) {
      console.error('[Composio] Initialization failed:', err.message);
      throw err;
    }
  }

  async mcpCall(method, params = {}) {
    if (!this.apiKey) {
      throw new Error('COMPOSIO_API_KEY is not configured');
    }

    const response = await fetch(this.mcpUrl, {
      method: 'POST',
      headers: {
        'x-consumer-api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      })
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw || `Composio MCP request failed (${response.status})`);
    }

    const dataLine = raw.split('\n').find((line) => line.startsWith('data: '));
    const payload = JSON.parse((dataLine ? dataLine.slice(6) : raw).trim());
    if (payload.error) {
      throw new Error(payload.error.message || JSON.stringify(payload.error));
    }

    return payload.result;
  }

  parseToolText(result) {
    const text = result?.content?.find?.((item) => item.type === 'text')?.text;
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_err) {
      return { raw: text };
    }
  }

  extractFirstToolData(parsed) {
    const first = parsed?.data?.results?.[0] || parsed?.data?.[0] || parsed?.results?.[0] || parsed;
    return first?.response?.data?.data || first?.response?.data || first?.data || first?.result?.data || first;
  }

  /**
   * List available post flairs for a subreddit
   */
  async listSubredditPostFlairs(subreddit) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const cacheKey = String(subreddit).toLowerCase();
      if (this.flairCache.has(cacheKey)) {
        return this.flairCache.get(cacheKey);
      }

      console.log(`[Composio] Fetching post flairs for r/${subreddit}...`);
      
      const result = await this.mcpCall('tools/call', {
        name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
        arguments: {
          tools: [{
            tool_slug: 'REDDIT_LIST_SUBREDDIT_POST_FLAIRS',
            arguments: { subreddit }
          }],
          thought: 'Fetching available post flairs for subreddit.',
          current_step: 'FETCHING_FLAIRS',
          sync_response_to_workbench: false
        }
      });

      const parsed = this.parseToolText(result);
      const data = this.extractFirstToolData(parsed);
      const flairs = data?.choices || data?.flairs || data?.data || data?.results || data || [];
      console.log(`[Composio] Found ${Array.isArray(flairs) ? flairs.length : 0} flairs for r/${subreddit}`);
      this.flairCache.set(cacheKey, flairs);
      return flairs;
    } catch (err) {
      console.warn(`[Composio] Failed to fetch flairs for r/${subreddit}:`, err.message);
      return [];
    }
  }

  async uploadScreenshotForReddit(title, imageBuffer) {
    if (!imageBuffer) return null;

    const hash = crypto
      .createHash('sha256')
      .update(imageBuffer)
      .digest('hex')
      .slice(0, 12);
    const titleSlug = String(title || 'godmode-screenshot')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'godmode-screenshot';

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([imageBuffer], { type: 'image/png' }), `${titleSlug}-${hash}.png`);

    const response = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: form
    });
    const url = (await response.text()).trim();
    if (!response.ok || !/^https?:\/\/\S+$/i.test(url)) {
      throw new Error(`Anonymous screenshot upload failed (${response.status}): ${url.slice(0, 200)}`);
    }

    return url;
  }

  /**
   * Post to Reddit via Composio MCP. Screenshots are uploaded to a public image
   * host and submitted as link posts.
   * Automatically fetches and applies the first available flair if the subreddit requires it.
   */
  async postToReddit(title, subreddit, imageBuffer) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      console.log(`[Composio] Posting to r/${subreddit}...`);

      const screenshotUrl = await this.uploadScreenshotForReddit(title, imageBuffer);

      // Fetch available flairs and use the first one if available
      const flairs = await this.listSubredditPostFlairs(subreddit);
      const postArgs = {
        subreddit,
        title
      };

      if (screenshotUrl) {
        postArgs.kind = 'link';
        postArgs.url = screenshotUrl;
        console.log(`[Composio] Uploaded screenshot for Reddit: ${screenshotUrl}`);
      } else {
        postArgs.kind = 'self';
        postArgs.text = 'Made with GodMode.';
      }

      // Add flair_id if available
      if (Array.isArray(flairs) && flairs.length > 0) {
        const firstFlair = flairs[0];
        const flairId = firstFlair?.id || firstFlair?.flair_template_id || firstFlair?.flair_id;
        if (flairId) {
          postArgs.flair_id = flairId;
          console.log(`[Composio] Using flair: ${firstFlair?.text || firstFlair?.flair_text || flairId}`);
        }
      }

      const result = await this.mcpCall('tools/call', {
        name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
        arguments: {
          tools: [{
            tool_slug: 'REDDIT_CREATE_REDDIT_POST',
            arguments: postArgs
          }],
          thought: 'Publish the requested GodMode Reddit update using the connected Reddit account.',
          current_step: 'POSTING_REDDIT_UPDATE',
          current_step_metric: '1/1 posts',
          sync_response_to_workbench: false
        }
      });

      const parsed = this.parseToolText(result);
      const data = this.extractFirstToolData(parsed);
      const success = data?.success !== false;
      if (!success) {
        throw new Error(data?.validation_message || data?.validation_error || data?.message || 'Reddit post failed');
      }

      console.log('[Composio] Posted to Reddit successfully');
      return {
        success: true,
        postId: data?.id || data?.name,
        url: (data?.permalink ? `https://reddit.com${data.permalink}` : undefined) || data?.json?.data?.url || data?.url,
        screenshotUrl,
        result: parsed || result
      };
    } catch (err) {
      console.error('[Composio] Failed to post to Reddit:', err.message);
      throw new Error(`Failed to post to Reddit: ${err.message}`);
    }
  }

  /**
   * Check Reddit connection status
   */
  async checkConnection() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.mcpCall('tools/call', {
        name: 'COMPOSIO_MANAGE_CONNECTIONS',
        arguments: {
          toolkits: [{ name: 'reddit', action: 'list' }]
        }
      });
      const parsed = this.parseToolText(result);
      const toolkit = parsed?.data?.toolkits?.find?.((item) => item.name === 'reddit' || item.toolkit === 'reddit')
        || parsed?.data?.results?.find?.((item) => item.toolkit === 'reddit')
        || parsed?.data?.results?.reddit
        || parsed?.data?.[0]
        || parsed?.data;
      const accounts = toolkit?.accounts || toolkit?.connected_accounts || [];
      const redditAccount = accounts.find?.((account) => String(account.status || '').toUpperCase() === 'ACTIVE') || accounts[0];

      return {
        connected: !!redditAccount,
        connectionId: redditAccount?.id,
        status: redditAccount?.status,
        appName: 'reddit',
        alias: redditAccount?.alias
      };
    } catch (err) {
      console.error('[Composio] Connection check failed:', err.message);
      return { connected: false, error: err.message };
    }
  }

  /**
   * Get connection URL for Reddit OAuth
   */
  async getConnectionUrl() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.mcpCall('tools/call', {
        name: 'COMPOSIO_MANAGE_CONNECTIONS',
        arguments: {
          toolkits: [{ name: 'reddit', action: 'add', alias: 'GodMode Reddit' }]
        }
      });
      const parsed = this.parseToolText(result);
      const data = parsed?.data || parsed;
      const first = data?.results?.[0] || data?.toolkits?.[0] || data?.[0] || data;
      const url = first?.redirect_url || first?.redirectUrl || first?.url;

      return {
        url,
        connectionId: first?.id || first?.account_id
      };
    } catch (err) {
      const errorMsg = err?.message || err?.error || String(err);
      console.error('[Composio] Failed to get connection URL:', errorMsg);
      throw new Error(errorMsg);
    }
  }
}

// Singleton instance
let composioService = null;

function getComposioService() {
  if (!composioService) {
    composioService = new ComposioRedditService();
  }
  return composioService;
}

module.exports = {
  ComposioRedditService,
  getComposioService
};
