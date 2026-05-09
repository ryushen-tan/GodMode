# ✅ Backboard Agent + Reddit Integration

## What's New

Your Backboard AI agent can now **post screenshots to Reddit** using natural language!

### How to Use

Just type in the prompt field:

```
Post a screenshot to r/gamedev with title "Check out my game!"
```

```
Share this on Reddit in the indiegames subreddit
```

```
Post a screenshot to r/godot titled "My FPS game progress"
```

The AI agent will:
1. 📸 **Capture** the Godot game window
2. 🤖 **Understand** your request
3. 🚀 **Post** to the subreddit you specified
4. 🔗 **Show** you the Reddit link

## Examples

### Quick Post
```
Post screenshot to r/gamedev
```
Default title: "Check out my game! Made with GodMode 🎮"

### Custom Title
```
Post a screenshot to r/indiegames with title "My first 3D game made with Godot!"
```

### Different Subreddits
```
Share on r/godot titled "Working on an FPS"
```

```
Post to r/Unity3D with title "Made this in Godot instead!"
```

## How It Works

```
You: "Post screenshot to r/gamedev"
    ↓
Backboard AI recognizes Reddit post request
    ↓
Returns: {"action": "post_to_reddit", "title": "...", "subreddit": "gamedev"}
    ↓
Agent captures Godot window screenshot
    ↓
Posts via Composio to Reddit API
    ↓
Shows: "✓ Posted to r/gamedev: [link]"
    ↓
You: Click link to view on Reddit! 🎉
```

## Features

✅ **Natural language** - No specific syntax needed  
✅ **Auto-capture** - Screenshots taken automatically  
✅ **Composio integration** - Uses your connected Reddit account  
✅ **Link in result** - Click to view your post  
✅ **Any subreddit** - Post wherever you want  

## Prerequisites

**Reddit must be connected via Composio:**

1. Go to https://app.composio.dev
2. Connect your Reddit account
3. Verify: `curl http://localhost:3001/api/reddit/status`
4. Should show: `{"connected": true}`

## Agent Response Format

When you ask to post to Reddit, the agent returns:

```json
{
  "action": "post_to_reddit",
  "title": "Check out my game!",
  "subreddit": "gamedev",
  "summary": "Posted screenshot to r/gamedev",
  "thinking": "User wants to share game screenshot"
}
```

The agent code then:
- Captures screenshot via IPC
- Converts to blob
- Posts to `/api/reddit/post`
- Returns Reddit URL

## UI Updates

The result box now shows:

```
Done: Posted screenshot to r/gamedev

Files modified:
• (none for Reddit posts)

🔴 View on Reddit →
```

Click the link to open your post!

## Code Changes

### `electron/services/backboard.js`
- ✅ Added `postToReddit()` function
- ✅ Updated system prompt with Reddit action
- ✅ Added action detection in response parser
- ✅ Captures screenshot via IPC
- ✅ Posts to backend endpoint

### `electron/renderer/app.js`
- ✅ Shows Reddit link in results
- ✅ Opens link with `window.electronAPI.openExternal()`

### `electron/renderer/styles.css`
- ✅ Added `.reddit-link` styling (orange theme)

## Testing

1. **Make sure Reddit is connected:**
   ```bash
   curl http://localhost:3001/api/reddit/status
   ```

2. **Launch GodMode:**
   ```bash
   npm start
   ```

3. **In the prompt field, type:**
   ```
   Post a screenshot to r/test with title "Testing GodMode Reddit integration"
   ```

4. **Click "Run Agent"**

5. **Watch the agent:**
   - Captures screenshot
   - Posts to Reddit
   - Shows link

6. **Click the link** to view your post!

## Popular Subreddits for Game Dev

- `r/gamedev` - General game development
- `r/indiegames` - Indie game showcases
- `r/godot` - Godot engine specific
- `r/Unity3D` - Unity (for comparison posts!)
- `r/unrealengine` - Unreal Engine
- `r/IndieDev` - Indie developers
- `r/Games` - Gaming in general
- `r/gaming` - Casual gaming community

## Error Handling

If Reddit isn't connected:
```
Error: Failed to post to Reddit: Not connected
```

**Solution:** Connect Reddit via Composio dashboard

If subreddit doesn't exist:
```
Error: Subreddit not found
```

**Solution:** Check the subreddit name

## Tips

- Use descriptive titles to get more engagement
- Post in relevant subreddits
- Check subreddit rules before posting
- Some subreddits require minimum karma

## What's Next

You can now:
- ✅ Code changes via agent
- ✅ Post to Reddit via agent
- ✅ All in natural language!

Try combining them:
```
Add a double jump to the player and then post a screenshot to r/gamedev showing it off
```

The agent will do both! 🚀

---

**Your Backboard agent is now Reddit-powered! 🤖🔴**
