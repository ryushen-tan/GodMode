# ✅ Composio Reddit Setup - Final Instructions

## Your Credentials

- **API Key:** `ck_MyzBwYwsn_ettgwHV3T7`
- **Entity ID:** `godmode-user`

## Current Status

✅ Backend running with Composio  
✅ Reddit button in UI (orange button, top-right)  
✅ Screenshot capture working  
⚠️ Need to connect Reddit via Composio Dashboard  

## Step-by-Step: Connect Reddit

### 1. Open Composio Dashboard

Go to: **https://app.composio.dev**

- Log in with your account
- Make sure you're using the account that has the API key `ck_MyzBwYwsn_ettgwHV3T7`

### 2. Navigate to Integrations/Apps

Look for:
- **"Integrations"** tab, or
- **"Apps"** menu, or
- **"Connected Accounts"**

### 3. Find Reddit

Search for "Reddit" in the apps list

### 4. Click "Connect" or "Add Integration"

### 5. Authorize Reddit

You'll be redirected to Reddit:
- Log in to your Reddit account
- Click **"Allow"** to authorize Composio

### 6. Verify Connection

Once back in Composio dashboard:
- You should see Reddit listed as **"Connected"**
- There will be a connection ID or status indicator

## Test It!

Once Reddit is connected via the dashboard:

### From Terminal:

```bash
# Check connection status
curl http://localhost:3001/api/reddit/status

# Should show:
# {"connected": true, "connectionId": "...", "status": "active"}
```

### From GodMode App:

1. **Launch GodMode:** `npm start`
2. **Click the orange Reddit button** (top-right corner)
3. **Enter post details:**
   - Title: "Check out my game! Made with GodMode 🎮"
   - Subreddit: "gamedev" (or any subreddit you want)
4. **Post!** 🎉

## Alternative: Manual Connection via API

If you can't access the dashboard, try this:

```bash
# Create an entity
curl -X POST https://backend.composio.dev/api/v3/entities \
  -H "x-api-key: ck_MyzBwYwsn_ettgwHV3T7" \
  -H "Content-Type: application/json" \
  -d '{"id": "godmode-user"}'

# This might return a connection URL for Reddit
```

## How the Integration Works

```
User clicks Reddit button
        ↓
Captures Godot screenshot
        ↓
Prompts for title & subreddit
        ↓
Sends to backend /api/reddit/post
        ↓
Backend uses Composio client.tools.execute()
        ↓
Composio posts to Reddit API
        ↓
Returns post URL
        ↓
Opens in browser ✅
```

## Troubleshooting

### "Connected: false"

**Solution:** Go to Composio dashboard and connect Reddit

### "Access Denied"

**Solution:** Check that you're logged into the right Composio account (the one with your API key)

### "Entity not found"

The entity `godmode-user` will be created automatically when you connect Reddit via the dashboard.

## Backend Endpoints

All endpoints are live and ready:

```
GET  /api/reddit/status     - Check if Reddit is connected
GET  /api/reddit/connect    - Get OAuth URL (if needed)
POST /api/reddit/post       - Post screenshot to Reddit
```

## Files Ready

✅ `backend/services/composio-reddit.js` - Reddit service  
✅ `backend/server.js` - Reddit API endpoints  
✅ `electron/renderer/index.html` - Orange Reddit button  
✅ `electron/renderer/styles.css` - Reddit button styling  
✅ `electron/renderer/app.js` - Reddit posting logic  

## Next Step

**Go to https://app.composio.dev and connect Reddit!**

Once connected, everything will work automatically! 🎮🔴

---

**Questions?** Check the Composio docs: https://docs.composio.dev
