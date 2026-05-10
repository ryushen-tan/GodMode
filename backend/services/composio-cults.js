class ComposioCultsService {
  constructor() {
    this.apiKey = process.env.COMPOSIO_API_KEY;
    this.mcpUrl = process.env.COMPOSIO_MCP_URL || 'https://connect.composio.dev/mcp';
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.apiKey) {
      throw new Error('COMPOSIO_API_KEY is not configured');
    }
    this.initialized = true;
    console.log('[Composio] Cults MCP integration initialized');
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

  async createShareUrl(fileUrl, origin) {
    await this.initialize();

    const result = await this.mcpCall('tools/call', {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: {
        tools: [{
          tool_slug: 'CULTS_SHARE_ON_CREATE_FR',
          arguments: {
            file_url: fileUrl,
            origin
          }
        }],
        thought: 'Generate a Cults3D share URL for a public 3D model file.',
        current_step: 'GENERATING_CULTS_SHARE_URL',
        current_step_metric: '1/1 share URLs',
        sync_response_to_workbench: false
      }
    });

    const parsed = this.parseToolText(result);
    const first = parsed?.data?.results?.[0] || parsed?.data?.[0] || parsed?.results?.[0] || parsed;
    const data = first?.response?.data || first?.data || first;
    if (data?.successful === false || first?.response?.successful === false) {
      throw new Error(data?.error || first?.response?.error || 'Cults share URL generation failed');
    }

    return {
      shareUrl: data?.share_url,
      fileUrl: data?.file_url || fileUrl,
      origin: data?.origin || origin,
      result: parsed || result
    };
  }

  async createCreation({ name, description, details, fileUrl, imageUrl }) {
    await this.initialize();

    const mutation = `
      mutation CreateGodModeCultsCreation(
        $name: String!,
        $description: String!,
        $details: String,
        $categoryId: ID!,
        $tagNames: [String!],
        $fileUrls: [String!]!,
        $imageUrls: [String!]!
      ) {
        createCreation(
          name: $name,
          description: $description,
          details: $details,
          categoryId: $categoryId,
          tagNames: $tagNames,
          locale: EN,
          visibility: PUBLIC,
          fileUrls: $fileUrls,
          imageUrls: $imageUrls,
          licenseCode: "cc_by",
          madeWithAi: true
        ) {
          creation {
            identifier
            name
            slug
            url
            shortUrl
            visibility
          }
          errors
        }
      }
    `;

    const result = await this.mcpCall('tools/call', {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: {
        tools: [{
          tool_slug: 'CULTS_GRAPH_QL_POST',
          arguments: {
            query: mutation,
            variables: {
              name,
              description,
              details,
              categoryId: process.env.CULTS_CATEGORY_ID || 'Q2F0ZWdvcnkvMzE',
              tagNames: ['godmode', 'ai-generated', 'game-asset'],
              fileUrls: [fileUrl],
              imageUrls: [imageUrl]
            },
            operationName: 'CreateGodModeCultsCreation'
          }
        }],
        thought: 'Create a public Cults3D design from a generated 3D model file.',
        current_step: 'CREATING_CULTS_CREATION',
        current_step_metric: '1/1 creations',
        sync_response_to_workbench: false
      }
    });

    const parsed = this.parseToolText(result);
    const first = parsed?.data?.results?.[0] || parsed?.data?.[0] || parsed?.results?.[0] || parsed;
    const graphql = first?.response?.data || first?.data || first;
    const graphQlErrors = graphql?.errors;
    if (Array.isArray(graphQlErrors) && graphQlErrors.length > 0) {
      throw new Error(graphQlErrors.map((err) => err.message || JSON.stringify(err)).join('; '));
    }

    const payload = graphql?.data?.createCreation || graphql?.createCreation;
    const mutationErrors = payload?.errors;
    if (Array.isArray(mutationErrors) && mutationErrors.length > 0) {
      throw new Error(mutationErrors.map((err) => typeof err === 'string' ? err : JSON.stringify(err)).join('; '));
    }
    if (!payload?.creation?.url) {
      throw new Error('Cults creation did not return a URL');
    }

    return {
      creationUrl: payload.creation.url,
      shortUrl: payload.creation.shortUrl,
      creation: payload.creation,
      fileUrl,
      imageUrl,
      result: parsed || result
    };
  }
}

let cultsService = null;

function getCultsService() {
  if (!cultsService) {
    cultsService = new ComposioCultsService();
  }
  return cultsService;
}

module.exports = {
  ComposioCultsService,
  getCultsService
};
