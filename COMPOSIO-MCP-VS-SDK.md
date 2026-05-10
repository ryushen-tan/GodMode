# ✅ Composio MCP vs SDK - Key Differences

## You're Right! MCP is Different

Your API key (`ck_MyzBwYwsn_ettgwHV3T7`) is for the **Composio MCP server**, NOT the Composio SDK!

### The Problem

We've been trying to use the **Composio SDK** (`@composio/core`) in the backend, but your API key is for the **Composio MCP** (Model Context Protocol) server.

**These are two different authentication systems!**

## What is Composio MCP?

From the docs research:

> **Composio MCP** is a Model Context Protocol server that connects AI clients (Claude Desktop, Cursor, etc.) to 500+ apps.
> 
> MCP uses **x-api-key header authentication** when `require_mcp_api_key` is enabled (default for new organizations).

### Authentication Difference

| Feature | Composio SDK | Composio MCP |
|---------|-------------|--------------|
| **Package** | `@composio/core` (npm) | MCP server at `connect.composio.dev/mcp` |
| **Auth Method** | API key in code: `new Composio({ apiKey })` | HTTP header: `x-api-key: ck_...` |
| **Usage** | Direct TypeScript/Node.js integration | AI clients via Model Context Protocol |
| **Your Key** | ❌ Not compatible | ✅ Compatible |

## Why Your Key Doesn't Work with SDK

Your key `ck_MyzBwYwsn_ettgwHV3T7` is an **MCP API key**, which:

1. Works with MCP servers (Claude Desktop, Cursor, etc.)
2. Requires `x-api-key` header for HTTP requests
3. **Does NOT work** with the `@composio/core` SDK directly

## Solution Options

### Option 1: Use Composio MCP Server (Recommended for Your Key)

Since you have an MCP key, we should use the MCP server via HTTP instead of the SDK.

**How it works:**
```
Your Backend
    ↓ HTTP POST with x-api-key header
Composio MCP Server (connect.composio.dev/mcp)
    ↓
Reddit API
```

**Update backend to use MCP HTTP API:**

```javascript
// backend/services/composio-reddit.js
const fetch = require('node-fetch');

async function postToReddit(title, subreddit, imageBase64) {
  // Call Composio MCP server via HTTP
  const response = await fetch('https://connect.composio.dev/mcp/reddit/submit', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.COMPOSIO_API_KEY, // Your MCP key
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title,
      subreddit,
      image: imageBase64
    })
  });
  
  return await response.json();
}
```

### Option 2: Get SDK-Compatible API Key

If you want to use the SDK (`@composio/core`), you need a **different type of API key**:

1. Go to https://app.composio.dev/settings/api
2. Look for "SDK API Keys" or "Platform API Keys"
3. Create a new key (might start with different prefix)
4. This key will work with `new Composio({ apiKey })`

### Option 3: Use Direct Reddit API (No Composio)

Skip Composio entirely:

1. Create Reddit app at https://reddit.com/prefs/apps
2. Get client ID + secret
3. Use `snoowrap` library for direct Reddit posting

## What We Built So Far

✅ **Backboard agent** can recognize Reddit post requests  
✅ **Screenshot capture** via IPC in main process  
✅ **Reddit posting logic** in backend  
✅ **UI shows Reddit links**  

**What needs changing:**
- Backend integration method (SDK → MCP HTTP or direct Reddit API)

## Recommendation

**Use Option 1 (Composio MCP HTTP API)**

Reasons:
- ✅ Works with your existing key
- ✅ No need to get new credentials
- ✅ Simpler HTTP-based integration
- ✅ Less code than SDK approach

## Next Steps

1. **Confirm which option you prefer:**
   - Option 1: Use MCP server via HTTP (I'll update the code)
   - Option 2: Get SDK key from Composio dashboard
   - Option 3: Use Reddit API directly

2. **Once you choose, I'll:**
   - Update the backend integration
   - Test the connection
   - Get you posting to Reddit! 🚀

## MCP Server URL

For Option 1, the MCP server is at:
```
https://connect.composio.dev/mcp
```

Authentication:
```bash
curl https://connect.composio.dev/mcp/some-endpoint \
  -H "x-api-key: ck_MyzBwYwsn_ettgwHV3T7"
```

---

**TL;DR:** Your key is for Composio MCP, not the SDK. We can either:
1. Switch to MCP HTTP API (easiest for your key)
2. Get a different key for the SDK
3. Use Reddit API directly

**Which option do you prefer?**
