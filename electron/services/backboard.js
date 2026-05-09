const { listFiles, readFile, writeFile, grepFiles, checkGodotErrors } = require('./fileEditor');

const BACKBOARD_API = 'https://app.backboard.io/api';

const SYSTEM_PROMPT = `You are GodMode — an expert Godot 4 game development agent.

CRITICAL: Your response MUST be ONLY valid JSON. No text before or after. No markdown. No code fences.

Required JSON format:
{
  "file": "relative/path/to/file.gd or .tscn",
  "content": "complete file content here",
  "summary": "one sentence describing changes",
  "thinking": "your reasoning process"
}

Rules:
- You can modify .gd (scripts) OR .tscn (scenes) files
- For scene files (.tscn): modify existing nodes, don't remove essential elements
- For adding walls/ramps/objects: modify the appropriate scene file (e.g., Levels/Main/L_Main.tscn)
- Always write the COMPLETE file content, preserving existing code that should stay
- Only change what the user asks for
- Maintain existing code style and structure
- For Godot 4 GDScript: Use Time.get_ticks_msec() NOT OS.get_ticks_msec()
- For Godot 4 GDScript: Use Input.get_vector() for WASD input
- Return ONLY the JSON object, nothing else`;

async function post(endpoint, apiKey, body) {
  const resp = await fetch(`${BACKBOARD_API}${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[GodMode] Backboard API error ${resp.status}:`, text);
    throw new Error(`Backboard ${resp.status}: ${text.slice(0, 300)}`);
  }
  const jsonData = await resp.json();
  console.log('[GodMode] API Response:', JSON.stringify(jsonData).slice(0, 1000));
  return jsonData;
}

// Extract keywords from the prompt to find relevant files via grep
function extractKeywords(prompt) {
  // Common Godot/code keywords + words from the prompt that might match code
  const words = prompt.toLowerCase().match(/\b[a-z_][a-z0-9_]{3,}\b/g) || [];
  const stopWords = new Set(['make', 'the', 'add', 'that', 'this', 'with', 'from', 'have', 'when', 'change', 'edit', 'update', 'modify', 'player', 'game', 'code', 'file', 'want', 'should', 'would', 'could', 'need', 'like']);
  return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 5);
}

async function runAgent(prompt, apiKey, threadId, onStep) {
  const MAX_RETRIES = 3;
  let currentThreadId = threadId;
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        onStep && onStep({ type: 'thinking', text: `Retry attempt ${attempt}/${MAX_RETRIES} after error...` });
      }
      
      // Step 1: Gather context using local file tools
      onStep && onStep({ type: 'tool_call', tool: 'list_files', args: {} });
      const allFiles = listFiles();
      onStep && onStep({ type: 'tool_result', tool: 'list_files', output: allFiles.slice(0, 200) });

      // Step 2: Grep for relevant files based on prompt keywords
      const keywords = extractKeywords(prompt);
      const relevantFiles = new Set();

      for (const kw of keywords) {
        onStep && onStep({ type: 'tool_call', tool: 'grep_files', args: { pattern: kw } });
        const hits = grepFiles(kw);
        onStep && onStep({ type: 'tool_result', tool: 'grep_files', output: hits.slice(0, 150) });
        // Extract file paths from grep output (format: "path/file.gd:line:content")
        for (const line of hits.split('\n')) {
          const match = line.match(/^([^:]+\.gd):/);
          if (match) relevantFiles.add(match[1]);
        }
      }

      // Step 3: Read relevant files (cap at 4 to avoid token overflow)
      const filesToRead = [...relevantFiles].filter(f => f.endsWith('.gd') || f.endsWith('.tscn')).slice(0, 4);
      
      // If request mentions walls, ramps, level, scene - include main scene
      const sceneKeywords = ['wall', 'ramp', 'platform', 'level', 'scene', 'object', 'add', 'create'];
      const needsScene = sceneKeywords.some(kw => prompt.toLowerCase().includes(kw));
      if (needsScene && !filesToRead.some(f => f.includes('L_Main.tscn'))) {
        filesToRead.unshift('Levels/Main/L_Main.tscn');
      }
      
      // Always include MovementController.gd if nothing else matched — it handles most gameplay
      if (filesToRead.length === 0) filesToRead.push('Player/MovementController.gd');

      const fileContents = {};
      for (const fp of filesToRead) {
        onStep && onStep({ type: 'tool_call', tool: 'read_file', args: { path: fp } });
        const content = readFile(fp);
        fileContents[fp] = content;
        onStep && onStep({ type: 'tool_result', tool: 'read_file', output: `${fp} (${content.length} chars)` });
      }

      // Step 4: Build the prompt with context and send to Backboard (with memory)
      const fileSection = Object.entries(fileContents)
        .map(([p, c]) => `=== ${p} ===\n${c}`)
        .join('\n\n');

      let fullPrompt = `All project files:\n${allFiles}\n\nRelevant file contents:\n${fileSection}\n\nUser request: ${prompt}`;
      
      // Add error context if retrying
      if (lastError) {
        fullPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED WITH ERRORS:\n${lastError}\n\nPlease fix these errors in your response.`;
      }

      onStep && onStep({ type: 'tool_call', tool: 'backboard_llm', args: { prompt: prompt.slice(0, 80) } });

      const requestBody = {
        content: fullPrompt,
        system_prompt: SYSTEM_PROMPT,
        memory: 'Auto',
        ...(currentThreadId ? { thread_id: currentThreadId } : {}),
      };
      
      console.log('[GodMode] Sending to Backboard:', JSON.stringify(requestBody).slice(0, 500));
      const data = await post('/threads/messages', apiKey, requestBody);
      console.log('[GodMode] Backboard response:', JSON.stringify(data).slice(0, 500));

      onStep && onStep({ type: 'tool_result', tool: 'backboard_llm', output: (data.content || 'EMPTY RESPONSE').slice(0, 100) });
      currentThreadId = data.thread_id; // Keep thread continuity

      // Step 5: Parse the JSON response — try multiple extraction strategies
      let parsed;
      const raw = (data.content || '').trim();
      
      onStep && onStep({ type: 'thinking', text: `Parsing LLM response (${raw.length} chars)...` });
      
      const parseAttempts = [
        // Strip markdown code fences (handles ```json\n{...}\n```)
        () => {
          let cleaned = raw;
          // Remove opening fence
          cleaned = cleaned.replace(/^```(?:json)?\s*/im, '');
          // Remove closing fence
          cleaned = cleaned.replace(/\s*```\s*$/m, '');
          return cleaned.trim();
        },
        // Extract just the {...} block, ignoring everything before/after
        () => { 
          const m = raw.match(/\{[\s\S]*?\}\s*$/m); 
          if (m) return m[0].trim(); 
          throw new Error('no JSON object found'); 
        },
        // Try raw as-is
        () => raw.trim(),
        // More aggressive: find first { to last }
        () => {
          const start = raw.indexOf('{');
          const end = raw.lastIndexOf('}');
          if (start >= 0 && end > start) {
            return raw.substring(start, end + 1);
          }
          throw new Error('no braces found');
        },
      ];
      
      let lastParseError = null;
      for (const tryParse of parseAttempts) {
        try {
          const extracted = tryParse();
          parsed = JSON.parse(extracted);
          break;
        } catch (e) {
          lastParseError = e.message;
        }
      }
      
      if (!parsed) {
        // Save the failed response for debugging
        const fs = require('fs');
        const debugPath = '/tmp/godmode-llm-response-debug.txt';
        fs.writeFileSync(debugPath, `=== Raw LLM Response ===\n${raw}\n\n=== Parse Error ===\n${lastParseError}`, 'utf8');
        
        onStep && onStep({ type: 'error', text: `Failed to parse JSON. Debug saved to ${debugPath}` });
        console.error('[GodMode] LLM Response Debug:', raw);
        throw new Error(`LLM returned invalid JSON. Last error: ${lastParseError}. Response preview: ${raw.slice(0, 300)}`);
      }

      if (!parsed.file || !parsed.content) {
        throw new Error(`LLM response missing required fields: ${JSON.stringify(parsed).slice(0, 200)}`);
      }

      // Show thinking if provided
      if (parsed.thinking) {
        onStep && onStep({ type: 'thinking', text: parsed.thinking });
      }

      onStep && onStep({ type: 'tool_call', tool: 'write_file', args: { path: parsed.file } });
      writeFile(parsed.file, parsed.content);
      onStep && onStep({ type: 'tool_result', tool: 'write_file', output: `Written: ${parsed.file}` });

      // Step 6: Check for Godot errors
      onStep && onStep({ type: 'tool_call', tool: 'check_errors', args: {} });
      const errorCheck = checkGodotErrors();
      
      if (errorCheck.success) {
        const msg = errorCheck.warning || '✓ No errors found!';
        onStep && onStep({ type: 'tool_result', tool: 'check_errors', output: msg });
        return {
          content: parsed.summary || `Modified ${parsed.file}`,
          thread_id: currentThreadId,
          filesChanged: [parsed.file],
        };
      } else {
        onStep && onStep({ type: 'tool_result', tool: 'check_errors', output: `✗ Errors found:\n${errorCheck.error}` });
        lastError = errorCheck.error;
        
        if (attempt === MAX_RETRIES) {
          throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error:\n${errorCheck.error}`);
        }
        // Continue to next retry
      }
      
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      lastError = error.message;
      onStep && onStep({ type: 'error', text: `Attempt ${attempt} failed: ${error.message}` });
    }
  }
}

module.exports = { runAgent };
