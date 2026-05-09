const { listFiles, readFile, writeFile, grepFiles } = require('./fileEditor');

const BACKBOARD_API = 'https://app.backboard.io/api';

const SYSTEM_PROMPT = `You are GodMode — an expert Godot 4 GDScript agent.

You are given the contents of the relevant game files and a user request.
Return ONLY a valid JSON object with no markdown, no explanation outside the JSON:

{
  "file": "<relative path to the .gd file you want to modify>",
  "content": "<complete new content of that file>",
  "summary": "<one sentence describing what you changed>"
}

Rules:
- Always write the COMPLETE file content, preserving existing code that should stay.
- Only change what the user asks for.
- Maintain existing code style and structure.
- If the request is ambiguous, make the most reasonable change.`;

async function post(endpoint, apiKey, body) {
  const resp = await fetch(`${BACKBOARD_API}${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Backboard ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

// Extract keywords from the prompt to find relevant files via grep
function extractKeywords(prompt) {
  // Common Godot/code keywords + words from the prompt that might match code
  const words = prompt.toLowerCase().match(/\b[a-z_][a-z0-9_]{3,}\b/g) || [];
  const stopWords = new Set(['make', 'the', 'add', 'that', 'this', 'with', 'from', 'have', 'when', 'change', 'edit', 'update', 'modify', 'player', 'game', 'code', 'file', 'want', 'should', 'would', 'could', 'need', 'like']);
  return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 5);
}

async function runAgent(prompt, apiKey, threadId, onStep) {
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
  const filesToRead = [...relevantFiles].filter(f => f.endsWith('.gd')).slice(0, 4);
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

  const fullPrompt = `All project files:\n${allFiles}\n\nRelevant file contents:\n${fileSection}\n\nUser request: ${prompt}`;

  onStep && onStep({ type: 'tool_call', tool: 'backboard_llm', args: { prompt: prompt.slice(0, 80) } });

  const data = await post('/threads/messages', apiKey, {
    content: fullPrompt,
    system_prompt: SYSTEM_PROMPT,
    memory: 'Auto',
    json_output: true,
    ...(threadId ? { thread_id: threadId } : {}),
  });

  onStep && onStep({ type: 'tool_result', tool: 'backboard_llm', output: (data.content || '').slice(0, 100) });

  // Step 5: Parse the JSON response (strip markdown code fences if present)
  let parsed;
  try {
    const raw = (data.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${(data.content || '').slice(0, 200)}`);
  }

  if (!parsed.file || !parsed.content) {
    throw new Error(`LLM response missing required fields: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  onStep && onStep({ type: 'tool_call', tool: 'write_file', args: { path: parsed.file } });
  writeFile(parsed.file, parsed.content);
  onStep && onStep({ type: 'tool_result', tool: 'write_file', output: `Written: ${parsed.file}` });

  return {
    content: parsed.summary || `Modified ${parsed.file}`,
    thread_id: data.thread_id,
    filesChanged: [parsed.file],
  };
}

module.exports = { runAgent };
