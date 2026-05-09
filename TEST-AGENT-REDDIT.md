# Test Backboard Agent Reddit Integration

## Quick Test Steps

### 1. Make Sure Backend is Running

```bash
curl http://localhost:3001/api/reddit/status
```

Should show:
```json
{
  "connected": false,
  "error": "..."
}
```

That's OK! The agent integration will still work once you connect Reddit.

### 2. Launch GodMode

```bash
cd /Users/ryushentan/Documents/GitHub/GodMode
npm start
```

### 3. Test the Agent Command

In the GodMode prompt field, type:

```
Post a screenshot to r/test with title "Testing Backboard Reddit integration"
```

Click **"Run Agent"**

### 4. Watch the Agent Steps

You should see in the agent log:
- 🤖 Agent thinking...
- 📸 `post_to_reddit(title="Testing...", subreddit="test")`
- ✓ Result: Posted to r/test

### 5. What Happens Next

**If Reddit IS connected via Composio:**
✅ Screenshot captured  
✅ Posted to Reddit  
✅ Link shown: "🔴 View on Reddit →"  
✅ Click to open your post!  

**If Reddit NOT connected:**
❌ Error: "Failed to post to Reddit: Not connected"  
→ **Solution:** Connect Reddit via Composio dashboard first  

## Connect Reddit (If Needed)

### Option 1: Composio Dashboard

1. Go to https://app.composio.dev
2. Log in (account with API key `ck_MyzBwYwsn_ettgwHV3T7`)
3. Find "Reddit" in apps
4. Click "Connect"
5. Authorize with your Reddit account

### Option 2: Check Status

```bash
# From terminal
curl http://localhost:3001/api/reddit/status

# Should show after connecting:
# {"connected": true, "connectionId": "...", "status": "active"}
```

## Example Commands to Try

### Basic Post
```
Post screenshot to r/gamedev
```

### With Custom Title
```
Post a screenshot to r/indiegames with title "My first game made with Godot and AI!"
```

### Different Subreddit
```
Share on r/godot titled "FPS game progress"
```

### After Code Changes
```
Add a wall at position (5, 0, 5) then post a screenshot to r/gamedev showing the new level
```

The agent will do BOTH tasks! 🤖

## Expected Response Format

When you ask to post to Reddit, the agent will:

1. **Detect Reddit request** from your natural language
2. **Return JSON:**
   ```json
   {
     "action": "post_to_reddit",
     "title": "Testing Backboard Reddit integration",
     "subreddit": "test",
     "summary": "Posted screenshot to r/test",
     "thinking": "User wants to share screenshot on Reddit"
   }
   ```
3. **Execute:**
   - Capture Godot window via IPC
   - Convert to blob
   - POST to `http://localhost:3001/api/reddit/post`
   - Return Reddit URL

4. **Show result:**
   ```
   Done: Posted screenshot to r/test
   
   🔴 View on Reddit →
   ```

## Debugging

### Check Agent Log

The floating agent log shows all steps:
```
💭 User wants to share screenshot on Reddit
post_to_reddit(title="Testing...", subreddit="test")
→ ✓ Posted to r/test: https://reddit.com/...
```

### Check Backend Logs

```bash
tail -f /tmp/composio-clean.log

# Should show:
# [Composio] Posting to r/test...
# [Composio] Posted to Reddit successfully
```

### Common Errors

**"Failed to capture screenshot"**
- Godot window not found
- Solution: Make sure Godot is running with the game open

**"Failed to post to Reddit: Not connected"**
- Reddit not connected via Composio
- Solution: Connect via dashboard (see above)

**"Subreddit not found"**
- Invalid subreddit name
- Solution: Check spelling, try r/test first

**"LLM returned invalid JSON"**
- Agent didn't understand the request
- Solution: Be more explicit: "post screenshot to reddit r/gamedev"

## Files Modified

✅ `electron/services/backboard.js` - Added Reddit posting
✅ `electron/renderer/app.js` - Shows Reddit link
✅ `electron/renderer/styles.css` - Reddit link styling

## What Works Now

- ✅ Natural language Reddit posting via agent
- ✅ Automatic screenshot capture
- ✅ Composio integration
- ✅ Clickable Reddit links
- ✅ Error handling
- ✅ Works alongside code changes

## Next Steps

1. **Connect Reddit** via Composio dashboard
2. **Test** with `r/test` subreddit first
3. **Then** post to real subreddits like `r/gamedev`
4. **Share** your game progress! 🎮

---

**Your Backboard agent is Reddit-ready! 🤖🔴**

Just connect Reddit via Composio and start posting!
