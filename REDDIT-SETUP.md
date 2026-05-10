# ✅ Switched to Reddit Integration!

## What's Changed

Your "Export to X" button is now **"Export to Reddit"**! 🎉

- 🔴 **Orange Reddit button** (top-right, next to GodMode logo)
- 📸 **Captures Godot game screenshot**
- 🚀 **Posts directly to any subreddit**

## Current Status

✅ Backend configured with your Composio API key  
✅ Reddit button added to UI  
✅ All endpoints switched to `/api/reddit/*`  
⚠️ Getting "Access Denied" from Composio API  

## Next Step: Connect Reddit via Composio Dashboard

Since the API is giving access denied, let's connect Reddit through the Composio web dashboard:

### 1. Go to Composio Dashboard

Visit: **https://app.composio.dev**

Log in with your account (the one with API key `ck_MyzBwYwsn_ettgwHV3T7`)

### 2. Connect Reddit

1. Navigate to **"Apps"** or **"Integrations"**
2. Find **"Reddit"** in the list
3. Click **"Connect"** or **"Add Connection"**
4. You'll be redirected to Reddit OAuth
5. **Log in to your Reddit account**
6. **Authorize Composio** to post on your behalf

### 3. Verify Connection

Once connected, you should see:
- ✅ Reddit listed as "Connected"
- A connection ID or status indicator

### 4. Test the Integration

**Option A: From Composio Dashboard**
- Try posting a test message through Composio's interface
- Verify it appears on Reddit

**Option B: From GodMode**
1. Launch GodMode: `npm start`
2. Click the **orange Reddit button** (top-right)
3. Choose your screenshot title and subreddit
4. Post!

## How to Use

Once Reddit is connected:

1. **Play your game in Godot**
2. **Click the orange Reddit button**
3. **Enter post title:**
   ```
   Check out my game! Made with GodMode 🎮
   ```
4. **Choose subreddit:**
   - `gamedev` - for game development posts
   - `indiegames` - for indie game showcases
   - `unity3d`, `unrealengine`, `godot` - for engine-specific
   - Or any subreddit you want!

5. **Screenshot posted!** 📸

## API Endpoints (for reference)

```bash
# Check connection status
GET http://localhost:3001/api/reddit/status

# Get OAuth URL (if needed)
GET http://localhost:3001/api/reddit/connect

# Post screenshot
POST http://localhost:3001/api/reddit/post
  - title: "Post title"
  - subreddit: "gamedev"
  - screenshot: <image file>
```

## Troubleshooting

### "Access Denied" Error

**Cause:** Composio API key needs entity/connection setup first

**Solution:**
1. Connect Reddit via Composio dashboard (see above)
2. The backend will automatically use your connection
3. No code changes needed!

### "Not connected" Status

Run this to check:
```bash
curl http://localhost:3001/api/reddit/status
```

If `"connected": false`, go back to Composio dashboard and connect Reddit.

### Can't find Composio dashboard?

- **Login**: https://app.composio.dev/login
- **Your API key**: `ck_MyzBwYwsn_ettgwHV3T7`
- **MCP Server**: https://connect.composio.dev/mcp

## What Changed in the Code

**Frontend:**
- ✅ Button changed from X logo to Reddit logo (orange)
- ✅ Prompts for title + subreddit
- ✅ Posts to `/api/reddit/post`

**Backend:**
- ✅ `composio-reddit.js` service
- ✅ Reddit OAuth endpoints
- ✅ Posts to `REDDIT_SUBMIT_IMAGE` action

**UI:**
- ✅ Orange button (#FF4500 - Reddit orange)
- ✅ Reddit Snoo logo SVG
- ✅ Hover effects

## Alternative: Direct Reddit API

If Composio doesn't work, I can switch to direct Reddit API:

**You'd need:**
1. Reddit App (create at https://reddit.com/prefs/apps)
2. Client ID + Secret
3. Add to `.env`

Let me know if you want to go this route instead!

---

**Next Step:** Go to https://app.composio.dev and connect Reddit! Then test the orange button! 🎮🔴
