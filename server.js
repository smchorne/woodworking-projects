// Load ANTHROPIC_API_KEY from .env
require('dotenv').config();

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = 3000;

app.use(express.json());

// Serve HTML, JSON, and asset files from the project root.
// Express.static skips dotfiles by default, so .env is never exposed.
app.use(express.static(path.join(__dirname)));

// ── POST /api/plan ──────────────────────────────────────────────────────────
// Accepts { skill_level, project_idea } from the browser.
// Uses the Agent SDK to run an agent that:
//   1. Reads wood-species.json via the filesystem MCP server
//   2. Recommends the best species for the project + skill level
//   3. Generates a full project plan with cut list and board feet
// Streams status updates and the final HTML plan back via Server-Sent Events.
app.post('/api/plan', async (req, res) => {
  const { skill_level, project_idea } = req.body;

  if (!skill_level || !project_idea) {
    return res.status(400).json({
      error: 'skill_level and project_idea are required.'
    });
  }

  // Set up Server-Sent Events
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  // Let the browser know we've started before the agent fires up
  res.write(`data: ${JSON.stringify({ status: 'Reading species database and generating your plan…' })}\n\n`);

  try {
    // Agent SDK is ESM-only — use dynamic import from CommonJS
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    // Build a clean environment for the Agent SDK subprocess.
    // - Add ~/.local/bin so it can find the claude CLI
    // - Remove CLAUDECODE so Claude Code doesn't refuse to start inside another session
    const agentEnv = {
      ...process.env,
      PATH: '/Users/sunnyhorne/.local/bin:' + process.env.PATH,
    };
    delete agentEnv.CLAUDECODE;

    let planHTML = '';

    for await (const message of query({
      prompt: buildPrompt(skill_level, project_idea),
      options: {
        // Set cwd so the agent can find wood-species.json
        cwd: __dirname,

        // Allow the built-in Read tool for direct file access
        allowedTools: ['Read'],

        // Filesystem MCP server gives the agent richer file access:
        // list_directory, read_file, search_files, etc.
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', __dirname]
          }
        },

        // Auto-accept any file reads without prompting
        permissionMode: 'acceptEdits',

        // Pass the clean environment to the agent subprocess
        env: agentEnv
      }
    })) {
      // The agent yields multiple message types as it works.
      // We only care about the final ResultMessage which has a 'result' key.
      if ('result' in message) {
        planHTML = message.result;
      }
    }

    // Strip markdown code fences if Claude wrapped the HTML in them
    planHTML = stripCodeFences(planHTML);

    // Send the complete plan to the browser and close the stream
    res.write(`data: ${JSON.stringify({ text: planHTML })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Build the agent prompt ──────────────────────────────────────────────────
function buildPrompt(skill_level, project_idea) {
  const levelLabel = skill_level.charAt(0).toUpperCase() + skill_level.slice(1);

  return `You are an expert woodworking instructor helping a ${skill_level} woodworker plan a project.

Project: ${project_idea}

Follow these steps:
1. Use the Read tool to read the file "wood-species.json" in the current directory. It contains real data on wood species including hardness, grain type, best uses, beginner_friendly flag, and finish recommendations.
2. From that data, choose the 1-2 best species for this project and skill level. Use the beginner_friendly flag and best_uses array to guide your choice.
3. Generate a complete project plan formatted as clean HTML.

Your entire response must be valid HTML content only — start with an <h2> tag and end with the last closing HTML tag. Do not include any explanatory text, markdown, or code fences outside the HTML.

Use ONLY these tags: <h2>, <h3>, <ul>, <ol>, <li>, <p>, <strong>, <em>, <table>, <tr>, <th>, <td>.
Do NOT include <html>, <head>, <body>, or <style> tags.

Include these sections in order:

<h2>Recommended Wood Species</h2>
Name, why it suits this project and skill level, Janka hardness, grain type, and finish tip — all pulled from the actual JSON data.

<h2>Project Overview</h2>
Brief description, estimated build time, difficulty note for a ${skill_level}.

<h2>Materials & Tools Needed</h2>
Two sub-lists: Materials and Tools.

<h2>Cut List</h2>
HTML table with columns: Part | Qty | Thickness (in) | Width (in) | Length (in)

<h2>Board Feet Required</h2>
For each piece: board feet = (thickness × width × length) / 144. Multiply by qty. Sum all pieces for net total. Add 15% for waste. State clearly: "Purchase X board feet."

<h2>Step-by-Step Instructions</h2>
Numbered steps with clear action verbs, appropriate for a ${skill_level}.

<h2>Finishing Recommendations</h2>
Use the finish_recommendation field from the JSON for the chosen species.

<h2>Tips for ${levelLabel} Woodworkers</h2>
Practical advice matched to this skill level.`;
}

// ── Strip markdown code fences if present ──────────────────────────────────
// Claude sometimes wraps HTML output in ```html ... ``` even when told not to.
function stripCodeFences(text) {
  return text
    .replace(/^```[a-z]*\n?/i, '')  // opening fence
    .replace(/\n?```$/,        '')  // closing fence
    .trim();
}

app.listen(PORT, () => {
  console.log(`\nWoodworking Project Planner → http://localhost:${PORT}/planner.html\n`);
});
