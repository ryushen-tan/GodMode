# Composio Twitter Integration Setup

## ✅ What's Been Added

Your GodMode app now has an **"Export to X"** button that lets you post game screenshots directly to Twitter/X using Composio.

### Features

- 📸 **One-click screenshot** of Godot game window
- 🐦 **Post to Twitter/X** with custom message
- 🔗 **Composio integration** for secure OAuth
- 🎮 **Automatic attribution** with #GodMode hashtag

## Setup Instructions

### Step 1: Get Your Composio API Key

1. **Sign up at Composio:**
   - Visit: https://app.composio.dev
   - Create an account (free tier available)

2. **Get your API key:**
   - Go to Settings → API Keys
   - Copy your API key

3. **Add to `.env` file:**
   ```bash
   COMPOSIO_API_KEY=your_actual_api_key_here
   COMPOSIO_ENTITY_ID=godmode-user
   ```

### Step 2: Connect Your Twitter Account

1. **Start the backend:**
   ```bash
   cd backend
   node server.js
   ```

2. **Get connection URL:**
   ```bash
   curl http://localhost:3001/api/twitter/connect
   ```

   This returns:
   ```json
   {
     "url": "https://app.composio.dev/...",
     "connectionId": "..."
   }
   ```

3. **Authorize Twitter:**
   - Open the URL in your browser
   - Log in to Twitter/X
   - Authorize the Composio app
   - Complete the OAuth flow

4. **Verify connection:**
   ```bash
   curl http://localhost:3001/api/twitter/status
   ```

   Should return:
   ```json
   {
     "connected": true,
     "connectionId": "...",
     "status": "active"
   }
   ```

### Step 3: Use the Export Button

1. **Launch GodMode:**
   ```bash
   npm start
   ```

2. **Click the X button:**
   - Look for the black circular button with X logo (next to GodMode button)
   - Top right corner of the overlay

3. **Post your screenshot:**
   - Button captures Godot game window automatically
   - Enter tweet text (or use default: "Check out my game! Made with #GodMode 🎮")
   - Click OK to post

4. **View your tweet:**
   - Browser opens automatically with your new tweet
   - Screenshot is attached to the post

## How It Works

```
User clicks Export → Electron captures Godot window
                ↓
         Convert to PNG buffer
                ↓
         Prompt for tweet text
                ↓
    Send to backend (/api/twitter/post)
                ↓
    Composio posts to Twitter API
                ↓
         Return tweet URL
                ↓
    Open tweet in browser ✓
```

## API Endpoints

### Check Connection Status
```bash
GET /api/twitter/status
```

Response:
```json
{
  "connected": true,
  "connectionId": "conn_123",
  "status": "active"
}
```

### Get OAuth URL
```bash
GET /api/twitter/connect
```

Response:
```json
{
  "url": "https://app.composio.dev/auth/...",
  "connectionId": "conn_123"
}
```

### Post Screenshot
```bash
POST /api/twitter/post
Content-Type: multipart/form-data

screenshot: <PNG file>
text: "My game screenshot! #GodMode"
```

Response:
```json
{
  "success": true,
  "tweetId": "1234567890",
  "url": "https://twitter.com/i/web/status/1234567890"
}
```

## Troubleshooting

### "Composio not initialized"
- Check that `COMPOSIO_API_KEY` is set in `.env`
- Restart the backend server

### "Twitter not connected"
1. Run: `curl http://localhost:3001/api/twitter/connect`
2. Open the returned URL
3. Complete Twitter OAuth
4. Verify: `curl http://localhost:3001/api/twitter/status`

### "Failed to capture screenshot"
- Make sure Godot is running
- Godot window must be visible (not minimized)
- Try clicking the Godot window first, then export

### "Failed to post to X"
- Check Twitter connection status
- Verify Composio API key is valid
- Check backend console for detailed errors

## Customization

### Change Default Tweet Text

Edit `electron/renderer/app.js`:
```javascript
const tweetText = prompt(
  'Tweet text:',
  'Your custom default message here! #YourHashtag'
);
```

### Change Button Position

Edit `electron/renderer/styles.css`:
```css
.export-x-btn {
  top: 20px;      /* Change vertical position */
  right: 96px;    /* Change horizontal position */
}
```

### Change Button Style

The button uses:
- X (Twitter) logo SVG
- Black background (#000000)
- Blue border (#1DA1F2 - Twitter blue)
- Hover effect with scale animation

## Files Modified

- ✅ `backend/services/composio-twitter.js` - Composio service
- ✅ `backend/server.js` - API endpoints added
- ✅ `electron/renderer/index.html` - Export button added
- ✅ `electron/renderer/styles.css` - Button styling
- ✅ `electron/renderer/app.js` - Screenshot & post logic
- ✅ `electron/preload.js` - IPC handlers
- ✅ `electron/main.js` - Window capture functionality
- ✅ `.env` - Composio credentials

## Security Notes

- ✅ Twitter OAuth handled by Composio (no credentials stored)
- ✅ API key stored in `.env` (not committed to git)
- ✅ Screenshots processed in-memory (not saved to disk)
- ✅ HTTPS used for all Composio API calls

## Support

**Composio Docs:** https://docs.composio.dev  
**Twitter API:** https://developer.twitter.com  
**GodMode Issues:** https://github.com/ryushen-tan/GodMode/issues

---

**You're all set! Click the X button to share your game! 🎮🐦**
