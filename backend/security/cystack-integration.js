/**
 * CyStack Security Integration with Telemetry
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// CyStack configuration
const CYSTACK_CONFIG = {
  organizationId: process.env.CYSTACK_ORG_ID || 'godmode-local',
  apiKey: process.env.CYSTACK_API_KEY || null,
  endpoint: process.env.CYSTACK_ENDPOINT || 'https://api.cystack.net/v1',
  telemetryEnabled: true,
};

// Security event types
const SecurityEventType = {
  FILE_SCAN: 'file.scan',
  FILE_IMPORTED: 'file.imported',
  THREAT_DETECTED: 'threat.detected',
};

// CyStack telemetry logger
class CyStackTelemetry {
  constructor(config = CYSTACK_CONFIG) {
    this.config = config;
    this.sessionId = crypto.randomUUID();
    this.telemetryLog = [];
    
    // Ensure logs directory exists
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logFile = path.join(logsDir, 'cystack-telemetry.jsonl');
  }

  /**
   * Send telemetry event to CyStack
   */
  async sendEvent(eventType, data) {
    const event = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      organizationId: this.config.organizationId,
      eventType,
      source: 'godmode-3d-pipeline',
      data,
    };

    // Log to console
    console.log(`[CyStack Telemetry] ${eventType}:`, data);

    // Write to telemetry log file
    this.writeToLog(event);

    // Send to CyStack API if configured
    if (this.config.apiKey && this.config.telemetryEnabled) {
      await this.sendToCyStackAPI(event);
    }

    this.telemetryLog.push(event);
    return event;
  }

  writeToLog(event) {
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('[CyStack] Failed to write telemetry log:', err.message);
    }
  }

  async sendToCyStackAPI(event) {
    try {
      const response = await fetch(`${this.config.endpoint}/telemetry`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new Error(`CyStack API returned ${response.status}`);
      }

      console.log('[CyStack] Telemetry sent to cloud');
    } catch (err) {
      console.warn('[CyStack] API call failed (local mode):', err.message);
    }
  }

  getTelemetry(limit = 100) {
    return this.telemetryLog.slice(-limit);
  }
}

// CyStack file scanner
class CyStackScanner {
  constructor(telemetry) {
    this.telemetry = telemetry || new CyStackTelemetry();
  }

  /**
   * Scan file and send telemetry to CyStack
   */
  async scanFile(buffer, metadata = {}) {
    const scanStart = Date.now();
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const scanData = {
      fileHash,
      fileSize: buffer.length,
      scanDurationMs: Date.now() - scanStart,
      source: metadata.source || 'unknown',
      filename: metadata.filename || 'unknown',
    };

    // Send telemetry to CyStack
    await this.telemetry.sendEvent(SecurityEventType.FILE_SCAN, scanData);

    return {
      hash: fileHash,
      size: buffer.length,
      scanned: true,
    };
  }

  /**
   * Log file import event
   */
  async logImport(filename, buffer, source) {
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    await this.telemetry.sendEvent(SecurityEventType.FILE_IMPORTED, {
      filename,
      fileHash,
      fileSize: buffer.length,
      source,
    });
  }
}

// Initialize CyStack
function initializeCyStack(config = {}) {
  const mergedConfig = { ...CYSTACK_CONFIG, ...config };
  const telemetry = new CyStackTelemetry(mergedConfig);
  const scanner = new CyStackScanner(telemetry);

  console.log('[CyStack] Integration initialized');
  console.log(`[CyStack] Organization: ${mergedConfig.organizationId}`);
  console.log(`[CyStack] Telemetry: ${mergedConfig.telemetryEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`[CyStack] API: ${mergedConfig.apiKey ? 'Connected' : 'Local mode'}`);

  return { telemetry, scanner, config: mergedConfig };
}

module.exports = {
  initializeCyStack,
  CyStackTelemetry,
  CyStackScanner,
  SecurityEventType,
  CYSTACK_CONFIG,
};
