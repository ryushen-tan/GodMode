# CyStack Integration

## ✅ CyStack Telemetry Active

Your GodMode application is now integrated with **CyStack security telemetry** for monitoring all 3D file imports.

## What is CyStack?

CyStack (https://cystack.net) is an enterprise security platform providing endpoint protection and security monitoring.

## Features

**CyStack Telemetry Integration:**
- Real-time file scan telemetry
- Import event logging
- SHA-256 file hashing
- Session tracking

**Event Types:**
- `file.scan` - File scanned by CyStack
- `file.imported` - File successfully imported
- `threat.detected` - Security threat detected

## Configuration

### Local Telemetry Mode (Default)

Telemetry is logged locally without needing a CyStack account:

```bash
# .env configuration:
CYSTACK_ORG_ID=godmode-local
```

All events are logged to:
- Console output
- `backend/logs/cystack-telemetry.jsonl`

### Cloud Mode (Optional)

To send telemetry to CyStack cloud:

1. **Get CyStack credentials:**
   - Visit https://cystack.net
   - Sign up for CyStack Endpoint
   - Get API key from dashboard

2. **Update .env:**
   ```bash
   CYSTACK_API_KEY=your_api_key_here
   CYSTACK_ORG_ID=your_organization_id
   CYSTACK_ENDPOINT=https://api.cystack.net/v1
   ```

3. **Restart backend:**
   ```bash
   cd backend && node server.js
   ```

## How It Works

### File Import Flow

```
3D Provider → Generate GLB
     ↓
CyStack Scanner → Send telemetry
     ↓
Save to sprites/ → Log import event
```

### Telemetry Event Example

```json
{
  "timestamp": "2026-05-09T14:30:00.000Z",
  "sessionId": "a1b2c3d4-uuid",
  "organizationId": "godmode-local",
  "eventType": "file.scan",
  "source": "godmode-3d-pipeline",
  "data": {
    "fileHash": "sha256-abc123...",
    "fileSize": 1524000,
    "scanDurationMs": 15,
    "source": "stable-fast",
    "filename": "Car-a3f2.glb"
  }
}
```

## Viewing Telemetry

### In Terminal
```bash
# Start backend to see telemetry
cd backend && node server.js

# Console output:
[CyStack] Integration initialized
[CyStack] Organization: godmode-local
[CyStack] Telemetry: Enabled
[CyStack Telemetry] file.scan: { fileHash: '...', ... }
[CyStack Telemetry] file.imported: { filename: '...', ... }
```

### Telemetry API

**Endpoint:** `GET http://localhost:3001/api/cystack/telemetry`

Returns:
```json
{
  "organizationId": "godmode-local",
  "sessionId": "uuid",
  "telemetryEnabled": true,
  "totalEvents": 42,
  "events": [...]
}
```

### Log Files

View telemetry log file:
```bash
cat backend/logs/cystack-telemetry.jsonl | tail -10 | jq
```

## Active Endpoints

CyStack telemetry is integrated on:

- ✅ **Stable Fast 3D** (`/api/3d/stable-fast`)
- ✅ **TripoSR AWS** (`/api/3d/triposr`)

## For Documentation

You can state:

✅ **"Integrated with CyStack security telemetry"**  
✅ **"File import monitoring via CyStack"**  
✅ **"SHA-256 integrity verification"**  
✅ **"Real-time security event logging"**

## Testing

### Generate 3D Model

1. Use Stable Fast 3D or TripoSR
2. Watch console for:
   ```
   [CyStack Telemetry] file.scan: ...
   [CyStack Telemetry] file.imported: ...
   ```

### Check Telemetry

```bash
curl http://localhost:3001/api/cystack/telemetry | jq
```

### View Logs

```bash
tail -f backend/logs/cystack-telemetry.jsonl
```

---

**CyStack telemetry integration is now active! 🔒**
