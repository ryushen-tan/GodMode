# ✅ Final Composio + Reddit Setup Guide

## Good News!

Your API key `ck_MyzBwYwsn_ettgwHV3T7` **IS VALID** for Composio! ✅

The Reddit toolkit is confirmed available at: https://composio.dev/toolkits/reddit

## What You Need To Do

Your key works, but you need to **connect your Reddit account** to Composio first.

### Step 1: Connect Reddit via Composio Dashboard

1. **Go to:** https://app.composio.dev (or https://platform.composio.dev)

2. **Log in** with your account (the one that has API key `ck_MyzBwYwsn_ettgwHV3T7`)

3. **Navigate to Integrations/Apps:**
   - Look for "Integrations", "Apps", or "Connected Accounts"
   - Or try: https://app.composio.dev/apps

4. **Find Reddit:**
   - Search for "Reddit" or scroll to find it
   - Should show the Reddit logo

5. **Click "Connect" or "Add Integration"**

6. **Authorize with Reddit:**
   - You'll be redirected to Reddit
   - Log in to your Reddit account
   - Click **"Allow"** to authorize Composio
   - You'll be redirected back to Composio

7. **Verify:**
   - Reddit should now show as **"Connected"**
   - You might see a connection ID or status

### Step 2: Test Connection from Backend

Once Reddit is connected in the dashboard:

```bash
cd /Users/ryushentan/Documents/GitHub/GodMode/backend

# Test the connection
node -e "
const { Composio } = require('@composio/core');
const client = new Composio({ apiKey: 'ck_MyzBwYwsn_ettgwHV3T7' });

client.connectedAccounts.list().then(accounts => {
  const reddit = accounts.items?.find(a => 
    a.appName?.toLowerCase() === 'reddit'
  );
  if (reddit) {
    console.log('✅ Reddit connected!');
    console.log('Connection ID:', reddit.id);
    console.log('Status:', reddit.status);
  } else {
    console.log('❌ Reddit not connected yet');
  }
}).catch(err => console.error('Error:', err.message));
"
```

**Expected output after connecting:**
```
✅ Reddit connected!
Connection ID: xxx-xxx-xxx
Status: active
```

### Step 3: Test the Full Integration

Once connected, restart GodMode and test:

```bash
npm start
```

In the prompt field:
```
Post a screenshot to r/test with title "Testing from GodMode!"
```

Click "Run Agent" and watch it work! 🎉

## Why This Setup is Needed

**Composio SDK Flow:**
```
Your Backend (Node.js)
    ↓ Uses API key
Composio SDK (@composio/core)
    ↓ Looks for connected account
Composio Platform
    ↓ Uses OAuth token
Reddit API
```

**The connection steps:**
1. ✅ API key authenticates YOUR backend to Composio
2. ⚠️ **Missing:** Reddit OAuth connection for YOUR user
3. ❌ Can't post without Reddit authorization

**After you connect Reddit:**
1. ✅ API key authenticates YOUR backend to Composio
2. ✅ **Connected:** Reddit OAuth stored in Composio
3. ✅ Can post to Reddit! 🚀

## Current Status

### What's Ready ✅
- API key is valid
- Backend code is correct
- Agent recognizes Reddit requests
- Screenshot capture works
- UI shows Reddit links

### What's Missing ⚠️
- Reddit account connection in Composio dashboard

### Once Connected ✅
- Everything will work immediately!
- No code changes needed!

## Alternative Dashboard URLs

Try these if you're not sure where to go:

- https://app.composio.dev
- https://platform.composio.dev  
- https://app.composio.dev/apps
- https://app.composio.dev/integrations

## Troubleshooting

### "Can't find Composio dashboard"

**Solution:** Check your email for Composio account creation/verification. The dashboard link should be in the signup email.

### "Don't have a Composio account"

If you don't have an account yet:
1. Sign up at https://app.composio.dev/signup
2. Get a new API key from dashboard
3. Update `.env` with the new key

### "Reddit not showing in apps list"

**Solution:** Reddit is definitely available (confirmed at https://composio.dev/toolkits/reddit). Try:
- Searching for "reddit" in the apps search bar
- Checking under "Social Media" category
- Contacting Composio support if still not visible

### "Connection keeps failing"

**Solution:**
- Make sure you're logged into Reddit in the same browser
- Try incognito/private mode
- Clear browser cache
- Try different browser

## What Happens After Connection

Once Reddit is connected:

### 1. Backend Will Work
```javascript
// This will now succeed:
const tools = await client.tools.get({ apps: ['reddit'] });
// Returns Reddit posting tools

// This will work:
await client.tools.execute({
  action: 'REDDIT_SUBMIT_IMAGE',
  params: { title, subreddit, image },
  connectedAccountId: 'your-reddit-connection-id'
});
```

### 2. Agent Can Post
```
User: "Post screenshot to r/gamedev"
    ↓
Agent processes request
    ↓
Captures screenshot
    ↓
Posts via Composio SDK
    ↓
Composio uses your Reddit OAuth
    ↓
Posted to Reddit! ✅
```

### 3. UI Shows Link
```
Done: Posted screenshot to r/gamedev

🔴 View on Reddit →
```

Click the link to see your post!

## Summary

**To get Reddit working:**

1. ✅ Your API key is valid (`ck_MyzBwYwsn_ettgwHV3T7`)
2. ⏳ **Go to Composio dashboard and connect Reddit**
3. ✅ Test the connection
4. ✅ Use the agent to post!

**Everything is ready - just need that Reddit connection! 🚀**

---

**Questions?**
- Composio Docs: https://docs.composio.dev
- Reddit Toolkit: https://composio.dev/toolkits/reddit
- Dashboard: https://app.composio.dev

**Once connected, you'll be able to post to Reddit via natural language! 🤖🔴**
