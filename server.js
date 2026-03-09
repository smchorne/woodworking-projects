// Load environment variables from .env (ANTHROPIC_API_KEY)
require('dotenv').config();

const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path     = require('path');

const app    = express();
const PORT   = 3000;
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from .env automatically

// Parse incoming JSON request bodies
app.use(express.json());

// Serve all HTML, JSON, and asset files from the project folder.
// Express.static skips dotfiles by default, so .env is never exposed.
app.use(express.static(path.join(__dirname)));

// ── POST /api/plan ──────────────────────────────────────────────────────────
// Accepts { skill_level, wood_species, project_idea } in the request body.
// Streams the Anthropic response back to the browser using Server-Sent Events
// so the plan appears word-by-word rather than waiting for the full response.
app.post('/api/plan', async (req, res) => {
  const { skill_level, wood_species, project_idea } = req.body;

  // Basic validation
  if (!skill_level || !wood_species || !project_idea) {
    return res.status(400).json({
      error: 'skill_level, wood_species, and project_idea are all required.'
    });
  }

  // Set up Server-Sent Events headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Stream the response from Claude
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,

      // System prompt defines Claude's role and the output format
      system: `You are an expert woodworking instructor with decades of hands-on workshop experience. You teach students at all skill levels — from complete beginners to advanced craftspeople.

When given a project idea, skill level, and wood species, write a thorough, practical project plan.

Format your entire response as clean HTML using only these tags: <h2>, <h3>, <ul>, <ol>, <li>, <p>, <strong>, <em>, <table>, <tr>, <th>, <td>.

Do NOT include <html>, <head>, <body>, or <style> tags — only inner content that will be injected into a page.

Always include these sections in order:
1. Project Overview — brief description, skill level note, estimated time
2. Materials & Tools Needed — two sub-lists: Materials and Tools
3. Cut List — an HTML table with columns: Part | Qty | Thickness | Width | Length (all in inches)
4. Step-by-Step Instructions — numbered steps with clear action verbs
5. Tips for This Skill Level — practical advice matched to the user's experience
6. Finishing Recommendations — finishing options suited to the chosen wood species`,

      messages: [{
        role: 'user',
        content: `Please create a complete woodworking project plan for the following:

Project Idea: ${project_idea}
Skill Level: ${skill_level}
Wood Species: ${wood_species}

Write the full plan as formatted HTML.`
      }]
    });

    // Send each streamed text chunk to the browser as an SSE event.
    // JSON.stringify safely escapes newlines and special characters.
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    // Tell the browser the stream is finished
    stream.on('finalMessage', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    // Forward stream errors to the browser
    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    // Catch setup errors (e.g. bad API key)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\nWoodworking Project Planner running at http://localhost:${PORT}/planner.html\n`);
});
