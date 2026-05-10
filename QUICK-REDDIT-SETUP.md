# Quick Reddit Setup Guide

## Your Composio Info

- **API Key:** `ck_MyzBwYwsn_ettgwHV3T7`
- **MCP Server:** `https://connect.composio.dev/mcp`

## The Situation

The Composio SDK has changed APIs and the old methods don't work. Here's the **easiest path forward**:

## Option 1: Connect via Composio Dashboard (Recommended)

### Step 1: Log into Composio
1. Go to: **https://app.composio.dev/login**
2. Log in with your account

### Step 2: Connect Reddit
1. Find **"Reddit"** in the apps list
2. Click **"Connect"** or **"Add Integration"**
3. Authorize with your Reddit account
4. **Copy the connection URL** they give you

### Step 3: Test It
Once connected, the backend should work automatically!

```bash
# Test status
curl http://localhost:3001/api/reddit/status

# Should show: "connected": true
```

## Option 2: Use Direct Reddit API (Faster)

Skip Composio entirely and use Reddit's API directly:

### Get Reddit API Credentials

1. **Go to:** https://www.reddit.com/prefs/apps
2. **Click:** "create another app..."
3. **Fill out:**
   - Name: `GodMode`
   - Type: Select **"script"**
   - Description: `Game screenshot posting`
   - About URL: (leave blank)
   - Redirect URI: `http://localhost:3001/reddit/callback`
4. **Click "create app"**

You'll get:
- **Client ID** (under the app name, looks like: `abc123xyz`)
- **Client Secret** (labeled "secret")

### Add to `.env`

```bash
# Reddit Direct API (instead of Composio)
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
```

### I'll Update the Code

Tell me if you want Option 2, and I'll:
1. Remove Composio dependency
2. Add `snoowrap` (Reddit API library)
3. Direct Reddit posting (no middleman!)

## Option 3: Simple HTTP Approach

Use Composio's REST API directly without the SDK:

```bash
# Connect Reddit via HTTP
curl -X POST https://backend.composio.dev/api/v3/entities/godmode-user/connections \
  -H "x-api-key: ck_MyzBwYwsn_ettgwHV3T7" \
  -H "Content-Type: application/json" \
  -d '{"appName": "reddit"}'
```

This might give you a connection URL to authorize.

## My Recommendation

**Go with Option 2 (Direct Reddit API)** because:

✅ **No Composio complexity**  
✅ **Direct control**  
✅ **Simpler debugging**  
✅ **Works offline**  
✅ **Free (no Composio subscription needed)**  

Just need your Reddit username/password or OAuth tokens!

## What Would You Like?

**A)** Try connecting via Composio dashboard  
**B)** Switch to direct Reddit API (I'll update the code)  
**C)** Debug Composio further  

Let me know and I'll help you get it working! 🎮🔴
