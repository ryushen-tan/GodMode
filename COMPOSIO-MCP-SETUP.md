# Composio MCP Server Setup

## Your Composio Credentials

- **API Key:** `ck_MyzBwYwsn_ettgwHV3T7`
- **MCP Server:** `https://connect.composio.dev/mcp`

## Current Status

✅ API key added to `.env`  
⚠️ API returning "Access Denied" - need to verify key or use different approach

## Alternative Setup Options

### Option 1: Use Composio Web Dashboard (Recommended)

1. **Go to Composio Dashboard:**
   - Visit: https://app.composio.dev
   - Log in with your account

2. **Connect Twitter:**
   - Navigate to "Apps" or "Connections"
   - Find "Twitter" / "X"
   - Click "Connect"
   - Authorize with your Twitter account

3. **Get Integration ID:**
   - Once connected, you'll get a `connection_id`
   - Save this for the backend

4. **Test posting:**
   - Use Composio's web interface to test a tweet
   - Verify it works before integrating

### Option 2: Use Direct Twitter API

Instead of Composio, we can use Twitter API directly:

1. **Get Twitter Developer Access:**
   - Visit: https://developer.twitter.com
   - Create a new app
   - Get API keys

2. **Add to `.env`:**
   ```bash
   TWITTER_API_KEY=your_key
   TWITTER_API_SECRET=your_secret  
   TWITTER_ACCESS_TOKEN=your_token
   TWITTER_ACCESS_SECRET=your_secret
   ```

3. **We'll use `twitter-api-v2` npm package**

### Option 3: Manual Composio Setup

Since you have the MCP server link, you can:

1. **Connect via MCP:**
   ```bash
   # Install Composio CLI
   npm install -g composio-core
   
   # Login
   composio login ck_MyzBwYwsn_ettgwHV3T7
   
   # Connect Twitter
   composio apps add twitter
   ```

2. **Follow the OAuth flow in terminal**

3. **Get the connection details:**
   ```bash
   composio connections list
   ```

## Quick Test

Let's verify your API key works:

```bash
curl -X GET https://backend.composio.dev/api/v1/apps \
  -H "x-api-key: ck_MyzBwYwsn_ettgwHV3T7"
```

If this returns apps list, your key is valid.

## What Would You Prefer?

**Option A:** Manual Composio dashboard connection (easiest)  
**Option B:** Direct Twitter API (more control)  
**Option C:** Debug current Composio integration  

Let me know which you'd like to proceed with!

---

**Current Error:** `🔑 Access Denied`

This suggests:
- API key might be for a different environment
- Missing permissions
- Need to connect Twitter first via dashboard
- Entity ID might need to be created first

Would you like me to:
1. Help you connect via Composio dashboard?
2. Switch to direct Twitter API?
3. Debug the Composio integration further?
