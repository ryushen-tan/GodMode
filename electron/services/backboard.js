const { listFiles, readFile, writeFile, grepFiles, checkGodotErrors } = require('./fileEditor');

const BACKBOARD_API = 'https://app.backboard.io/api';

// Reddit posting function (called from main.js with screenshot data)
async function postToReddit(title, subreddit, screenshotBase64) {
  try {
    if (!screenshotBase64) {
      throw new Error('No screenshot provided');
    }

    // Convert base64 to buffer
    const base64Data = screenshotBase64.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Create form data
    const formData = new FormData();
    formData.append('screenshot', new Blob([buffer], { type: 'image/png' }), 'game-screenshot.png');
    formData.append('title', title);
    formData.append('subreddit', subreddit);

    const response = await fetch('http://localhost:3001/api/reddit/post', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (response.ok) {
      return {
        success: true,
        url: result.url,
        postId: result.postId
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to post to Reddit'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

const SYSTEM_PROMPT = `You are GodMode — an expert Godot 4 game development agent with Reddit posting capabilities.

CRITICAL: Your response MUST be ONLY valid JSON. No text before or after. No markdown. No code fences.
CRITICAL: DO NOT use any tools or functions (like read_file or edit_file). You already have all necessary file contents in the prompt. You must output the final JSON directly in your response.

Required JSON format (for code changes):
{
  "file": "relative/path/to/file.gd or .tscn",
  "content": "complete file content here",
  "summary": "one sentence describing changes",
  "thinking": "your reasoning process"
}

OR for Reddit posts:
{
  "action": "post_to_reddit",
  "title": "Post title here",
  "subreddit": "gamedev",
  "summary": "Posted screenshot to Reddit",
  "thinking": "your reasoning"
}

Special Actions:
- To post a screenshot to Reddit: Return {"action": "post_to_reddit", "title": "...", "subreddit": "gamedev", "summary": "...", "thinking": "..."}
- User can say things like "post a screenshot to reddit" or "share this on r/gamedev"

Rules for Code Changes:
- You can modify .gd (scripts) OR .tscn (scenes) files
- For scene files (.tscn): modify existing nodes, don't remove essential elements
- For adding walls/ramps/objects: modify the appropriate scene file (e.g., Levels/Main/L_Main.tscn)
- ALL 3D models/sprites are in "res://sprites/". The user's prompt will contain the EXACT filename (e.g., "res://sprites/ARedApple-a58a.glb"). Use the EXACT path provided - do NOT change or simplify the filename.
- When adding a new 3D model (.glb file) to a scene, you MUST follow this pattern:
  1. Add [ext_resource type="PackedScene" uid="uid://unique_id" path="res://sprites/EXACT_FILENAME.glb" id="X_shortname"]
     CRITICAL: type MUST be "PackedScene" (NOT "GLTF"), .glb files are imported as PackedScene in Godot
  2. Add [node name="ObjectName" parent="." unique_id=NNNNNN instance=ExtResource("X_shortname")]
     CRITICAL: Use "instance=ExtResource(...)" NOT "mesh=ExtResource(...)"
  3. Use the EXACT sprite path from the user's prompt
  Example:
    [ext_resource type="PackedScene" uid="uid://car_res" path="res://sprites/ACar-b757.glb" id="7_car"]
    [node name="Car" parent="." unique_id=123456 instance=ExtResource("7_car")]
- Always write the COMPLETE file content, preserving existing code that should stay. DO NOT truncate. DO NOT use "...". You must output the entire file from top to bottom.
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

async function runAgent(prompt, apiKey, threadId, onStep, captureScreenshot) {
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

      // Step 1.5: List available sprites (including newly generated meshes)
      const fs = require('fs');
      const path = require('path');
      // electron/services/backboard.js -> go up to electron/ -> up to root -> into example_game
      const spritesDir = path.join(__dirname, '..', '..', 'example_game', 'godot-FirstPersonStarter-main', 'sprites');
      let availableSprites = [];
      try {
        availableSprites = fs.readdirSync(spritesDir)
          .filter(f => f.toLowerCase().endsWith('.glb'))
          .map(f => `res://sprites/${f}`);
        console.log(`[GodMode] Found ${availableSprites.length} sprites in ${spritesDir}`);
      } catch (err) {
        console.error('[GodMode] Could not list sprites:', err.message);
        console.error('[GodMode] Tried path:', spritesDir);
      }

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

      const spritesSection = availableSprites.length > 0
        ? `\n\nAvailable 3D models in sprites folder:\n${availableSprites.join('\n')}`
        : '';

      let fullPrompt = `All project files:\n${allFiles}${spritesSection}\n\nRelevant file contents:\n${fileSection}\n\nUser request: ${prompt}`;
      
      // Add error context if retrying
      if (lastError) {
        fullPrompt += `\n\n⚠️ PREVIOUS ATTEMPT FAILED WITH ERRORS:\n${lastError}\n\nDO NOT USE TOOLS. Write the raw JSON output directly starting with { and ending with }.`;
      }

      onStep && onStep({ type: 'tool_call', tool: 'backboard_llm', args: { prompt: prompt.slice(0, 80) } });

      const requestBody = {
        content: fullPrompt,
        system_prompt: SYSTEM_PROMPT,
        memory: 'Auto',
        model: 'claude-3-7-sonnet-20250219',
        json_output: true,
        tools: [],
        tool_choice: "none",
        ...(currentThreadId ? { thread_id: currentThreadId } : {}),
      };
      
      console.log('[GodMode] Sending to Backboard:', JSON.stringify(requestBody).slice(0, 500));
      const data = await post('/threads/messages', apiKey, requestBody);
      console.log('[GodMode] Backboard response:', JSON.stringify(data).slice(0, 500));

      onStep && onStep({ type: 'tool_result', tool: 'backboard_llm', output: (data.content || 'EMPTY RESPONSE').slice(0, 100) });
      currentThreadId = data.thread_id; // Keep thread continuity

      // Step 5: Parse the JSON response — try multiple extraction strategies
      let parsed;
      let raw = (data.content || '').trim();
      
      // Fallback: if the LLM stubbornly decided to use a tool instead of returning content
      if (!raw && data.tool_calls && data.tool_calls.length > 0) {
        throw new Error(`CRITICAL: You attempted to call a tool (${data.tool_calls[0].function?.name}). This is forbidden. You already have the file contents. You MUST output the final JSON directly in your message content.`);
      }
      
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

      // Check if this is a Reddit post action
      if (parsed.action === 'post_to_reddit') {
        if (!parsed.title || !parsed.subreddit) {
          throw new Error('Reddit post requires title and subreddit');
        }

        if (!captureScreenshot) {
          throw new Error('Screenshot capture function not available');
        }

        // Show thinking if provided
        if (parsed.thinking) {
          onStep && onStep({ type: 'thinking', text: parsed.thinking });
        }

        // Capture screenshot via callback
        onStep && onStep({ type: 'tool_call', tool: 'capture_screenshot', args: {} });
        const screenshot = await captureScreenshot();
        if (!screenshot) {
          throw new Error('Failed to capture screenshot');
        }
        onStep && onStep({ type: 'tool_result', tool: 'capture_screenshot', output: '✓ Screenshot captured' });

        // Post to Reddit
        onStep && onStep({ type: 'tool_call', tool: 'post_to_reddit', args: { title: parsed.title, subreddit: parsed.subreddit } });
        const redditResult = await postToReddit(parsed.title, parsed.subreddit, screenshot);
        
        if (redditResult.success) {
          onStep && onStep({ type: 'tool_result', tool: 'post_to_reddit', output: `✓ Posted to r/${parsed.subreddit}: ${redditResult.url}` });
          return {
            content: parsed.summary || `Posted screenshot to r/${parsed.subreddit}`,
            thread_id: currentThreadId,
            redditUrl: redditResult.url,
          };
        } else {
          throw new Error(`Failed to post to Reddit: ${redditResult.error}`);
        }
      }

      // Standard file modification flow
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
