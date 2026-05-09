#!/bin/bash

echo "🔧 Composio Twitter Integration Setup"
echo "======================================"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
  echo "❌ Error: .env file not found"
  exit 1
fi

# Check if Composio API key is set
if grep -q "COMPOSIO_API_KEY=your_composio_api_key_here" .env; then
  echo "⚠️  Composio API key not configured"
  echo ""
  echo "Please follow these steps:"
  echo "1. Visit https://app.composio.dev"
  echo "2. Sign up / log in"
  echo "3. Go to Settings → API Keys"
  echo "4. Copy your API key"
  echo ""
  read -p "Paste your Composio API key: " api_key
  
  if [ -z "$api_key" ]; then
    echo "❌ No API key provided"
    exit 1
  fi
  
  # Update .env
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/COMPOSIO_API_KEY=your_composio_api_key_here/COMPOSIO_API_KEY=$api_key/" .env
  else
    sed -i "s/COMPOSIO_API_KEY=your_composio_api_key_here/COMPOSIO_API_KEY=$api_key/" .env
  fi
  
  echo "✅ API key saved to .env"
else
  echo "✅ Composio API key already configured"
fi

echo ""
echo "Starting backend server..."
cd backend

# Start backend in background
node server.js > /tmp/godmode-composio-setup.log 2>&1 &
BACKEND_PID=$!

echo "⏳ Waiting for backend to start..."
sleep 3

# Check if backend is running
if ! ps -p $BACKEND_PID > /dev/null; then
  echo "❌ Backend failed to start. Check logs:"
  cat /tmp/godmode-composio-setup.log
  exit 1
fi

echo "✅ Backend running (PID: $BACKEND_PID)"
echo ""

# Get Twitter connection URL
echo "🐦 Setting up Twitter connection..."
RESPONSE=$(curl -s http://localhost:3001/api/twitter/connect)

if echo "$RESPONSE" | grep -q "url"; then
  URL=$(echo "$RESPONSE" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
  echo ""
  echo "✅ Connection URL generated!"
  echo ""
  echo "📋 Next steps:"
  echo "1. Open this URL in your browser:"
  echo ""
  echo "   $URL"
  echo ""
  echo "2. Log in to Twitter/X"
  echo "3. Authorize the Composio app"
  echo "4. Return here when done"
  echo ""
  
  # Try to open URL automatically
  if command -v open &> /dev/null; then
    echo "Opening browser automatically..."
    open "$URL"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
  fi
  
  echo ""
  read -p "Press Enter after you've completed the authorization..."
  
  # Check connection status
  echo ""
  echo "🔍 Checking Twitter connection..."
  STATUS=$(curl -s http://localhost:3001/api/twitter/status)
  
  if echo "$STATUS" | grep -q '"connected":true'; then
    echo "✅ Twitter connected successfully!"
    echo ""
    echo "🎉 Setup complete! You can now:"
    echo "   - Start GodMode: npm start"
    echo "   - Click the X button to post screenshots"
  else
    echo "⚠️  Connection not detected. Status:"
    echo "$STATUS"
    echo ""
    echo "Try running the connection URL again if needed."
  fi
else
  echo "❌ Failed to get connection URL"
  echo "Response: $RESPONSE"
fi

echo ""
echo "Stopping backend..."
kill $BACKEND_PID 2>/dev/null

echo ""
echo "📖 For more details, see COMPOSIO-SETUP.md"
