/**
 * Composio Twitter/X Integration
 * Handles posting game screenshots to Twitter/X
 */

const { Composio } = require('composio');

class ComposioTwitterService {
  constructor() {
    this.apiKey = process.env.COMPOSIO_API_KEY;
    this.entityId = process.env.COMPOSIO_ENTITY_ID || 'godmode-user';
    this.client = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    if (!this.apiKey) {
      console.warn('[Composio] API key not configured - Twitter integration disabled');
      return;
    }

    try {
      this.client = new Composio(this.apiKey);
      this.initialized = true;
      console.log('[Composio] Twitter integration initialized');
      console.log(`[Composio] Entity ID: ${this.entityId}`);
    } catch (err) {
      console.error('[Composio] Initialization failed:', err.message);
      throw err;
    }
  }

  /**
   * Post a tweet with an image
   */
  async postTweet(text, imageBuffer) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.client) {
      throw new Error('Composio not initialized - check COMPOSIO_API_KEY');
    }

    try {
      console.log('[Composio] Posting tweet with image...');
      
      // Convert image buffer to base64
      const imageBase64 = imageBuffer.toString('base64');

      // Execute Twitter action via Composio
      const result = await this.client.actions.execute({
        actionName: 'TWITTER_CREATION_OF_A_POST',
        params: {
          text: text,
          media: [{
            data: imageBase64,
            mediaType: 'image/png'
          }]
        },
        entityId: this.entityId
      });

      console.log('[Composio] Tweet posted successfully');
      return {
        success: true,
        tweetId: result.data?.id,
        url: result.data?.url || `https://twitter.com/i/web/status/${result.data?.id}`,
        result
      };
    } catch (err) {
      console.error('[Composio] Failed to post tweet:', err.message);
      throw new Error(`Failed to post to Twitter: ${err.message}`);
    }
  }

  /**
   * Check Twitter connection status
   */
  async checkConnection() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.client) {
      return { connected: false, reason: 'No API key' };
    }

    try {
      const entity = await this.client.entities.get({ id: this.entityId });
      const connections = await entity.getConnections();
      
      const twitterConnection = connections.find(
        conn => conn.appName === 'twitter' || conn.appName === 'x'
      );

      return {
        connected: !!twitterConnection,
        connectionId: twitterConnection?.id,
        status: twitterConnection?.status
      };
    } catch (err) {
      console.error('[Composio] Connection check failed:', err.message);
      return { connected: false, error: err.message };
    }
  }

  /**
   * Get connection URL for Twitter OAuth
   */
  async getConnectionUrl() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.client) {
      throw new Error('Composio not initialized');
    }

    try {
      const entity = await this.client.entities.get({ id: this.entityId });
      const connection = await entity.initiateConnection({
        appName: 'twitter'
      });

      return {
        url: connection.redirectUrl,
        connectionId: connection.connectionId
      };
    } catch (err) {
      console.error('[Composio] Failed to get connection URL:', err.message);
      throw err;
    }
  }
}

// Singleton instance
let composioService = null;

function getComposioService() {
  if (!composioService) {
    composioService = new ComposioTwitterService();
  }
  return composioService;
}

module.exports = {
  ComposioTwitterService,
  getComposioService
};
