# Get Working Composio API Key

## Current Issue

The API key `ck_MyzBwYwsn_ettgwHV3T7` is being rejected by Composio:

```
401 {"error":{"message":"Invalid API key: ck_MyzBw*****"}}
```

This means the key is either:
- ❌ Expired or revoked
- ❌ Invalid or has a typo
- ❌ Not activated yet
- ❌ Missing required permissions

## How to Get a Valid Key

### Option 1: Composio Dashboard (Recommended)

1. **Go to:** https://app.composio.dev/login

2. **Log in** or **Sign up** with:
   - Email/Password
   - Google
   - GitHub

3. **Navigate to API Keys:**
   - Click your profile (top-right)
   - Select "Settings" or "API Keys"
   - Or go directly to: https://app.composio.dev/settings/api

4. **Create New API Key:**
   - Click "Create API Key" or "Generate New Key"
   - Give it a name: `GodMode`
   - Copy the key (starts with `ck_`)
   - **IMPORTANT:** Save it immediately - you won't see it again!

5. **Update Your .env:**
   ```bash
   cd /Users/ryushentan/Documents/GitHub/GodMode
   
   # Edit .env file
   # Replace the COMPOSIO_API_KEY line with your new key:
   COMPOSIO_API_KEY=ck_YOUR_NEW_KEY_HERE
   ```

6. **Restart Backend:**
   ```bash
   cd backend
   pkill -f server.js
   node server.js &
   ```

### Option 2: Composio CLI

```bash
# Install CLI
npm install -g composio-core

# Login
composio login

# This will open a browser for you to authenticate

# Get your API key
composio whoami

# Copy the API key shown
```

### Option 3: Check Existing Keys

If you have an account:

1. Go to https://app.composio.dev/settings/api
2. Check if you have existing keys
3. If the key shows as "Active", copy it
4. If it shows as "Revoked", create a new one

## Test Your New Key

### Quick Test (Terminal)

```bash
# Replace with your actual key
curl -s "https://backend.composio.dev/api/v1/apps" \
  -H "x-api-key: ck_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" | head -20

# Should return a list of available apps
# If you see "Invalid API key" - the key is wrong
# If you see apps listed - key is valid! ✅
```

### Test via Backend

```bash
# Update .env with new key first, then:
cd /Users/ryushentan/Documents/GitHub/GodMode/backend
pkill -f server.js
node server.js &

# Wait 3 seconds, then test:
curl http://localhost:3001/api/reddit/status

# Should return:
# {"connected": false, ...} with no 401 error
```

## Connect Reddit (After Valid Key)

Once you have a valid API key:

### 1. Go to Composio Dashboard

https://app.composio.dev

### 2. Navigate to Apps/Integrations

Look for:
- "Integrations" tab
- "Connected Apps"
- "Apps" menu

### 3. Find Reddit

Search for "Reddit" or scroll to find it

### 4. Click "Connect" or "Add Integration"

### 5. Authorize

You'll be redirected to Reddit:
- Log in to your Reddit account
- Click "Allow" to authorize Composio

### 6. Verify Connection

```bash
curl http://localhost:3001/api/reddit/status

# Should return:
# {"connected": true, "connectionId": "...", "status": "active"}
```

## Then Test the Agent!

```bash
# Launch GodMode
npm start

# In the prompt field, type:
Post a screenshot to r/test with title "Testing GodMode!"

# Click "Run Agent"
# Watch it post to Reddit! 🎉
```

## Troubleshooting

### "I can't find API Keys in the dashboard"

Try these URLs directly:
- https://app.composio.dev/settings
- https://app.composio.dev/settings/api
- https://app.composio.dev/account

### "I don't have a Composio account"

Sign up free at:
- https://app.composio.dev/signup

No credit card required for basic features!

### "The key still doesn't work"

1. **Double-check for typos**
   - Keys are case-sensitive
   - Should start with `ck_`
   - No spaces before/after

2. **Try regenerating**
   - Delete old key in dashboard
   - Create a brand new one
   - Update .env immediately

3. **Check account status**
   - Make sure your Composio account is active
   - Verify email if needed

### "Reddit connection fails"

If the key works but Reddit won't connect:

1. Make sure you're logged into Reddit
2. Check Reddit app permissions in your Reddit account settings
3. Try disconnecting and reconnecting in Composio dashboard

## Alternative: Use Reddit API Directly

If Composio continues to have issues, I can switch to Reddit's API directly:

**You'd need:**
1. Reddit App credentials (from https://reddit.com/prefs/apps)
2. Your Reddit username/password
3. Update .env with Reddit credentials

Let me know if you want this alternative!

## Key Format Reference

Valid Composio API keys look like:
```
ck_MyzBwYwsn_ettgwHV3T7
^^                      ^^
Starts with "ck_"       About 20-25 chars total
```

---

**Once you have a valid key, everything is ready to work! 🚀**
