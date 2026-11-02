#!/usr/bin/env node
// MCP server so Claude can run the companion from any conversation:
// "I'm starting Banafah", "done with that", "how am I doing?".
// Thin client of the background service (src/daemon.js); starts it if needed.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from './client.js';

const { call } = createClient();

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const tool = (name, description, shape, fn) => server.registerTool(name, { description, inputSchema: shape }, async (args) => {
  try { return text(await fn(args || {})); } catch (e) { return { ...text(`error: ${e.message}`), isError: true }; }
});

const server = new McpServer({ name: 'nudgling', version: '0.1.0' });

tool('companion_status', 'Current focus state: active quest and next step, level and XP progress, skills, titles, streak, boss HP, nudge stats, paused or not.', {}, () => call('GET', '/status'));
tool('companion_list_quests', 'List all quests with progress and which one is active.', {}, () => call('GET', '/quests'));
tool('companion_add_quest', 'Add a quest (a goal broken into tiny steps) and by default make it active. Steps should each take under ~10 minutes; the first under 2. allow = keywords that appear in window titles/apps when working on it (e.g. "merchant center"). A deadline makes it a boss fight.', {
  title: z.string(), steps: z.array(z.string()).default([]), tag: z.string().optional().describe('Skill: Client Work, Code, Admin, Sales, Health, Creative...'),
  allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional(), deadline: z.string().optional().describe('YYYY-MM-DD'), activate: z.boolean().default(true),
  repo: z.string().optional().describe('For coding quests: the git working folder (your current directory). Nudgling then warns when uncommitted changes pile up.'),
}, (a) => call('POST', '/quests', a));
tool('companion_scope_check', 'Before starting work on a NEW request in the middle of a quest, check whether it is part of the active quest or scope creep (e.g. a bug fix turning into new features). If verdict is "creep", tell the user, suggest finishing and committing the current work first, and offer companion_park or a new quest.', { request: z.string().describe("The user's new request, in their words") }, (a) => call('POST', '/scope/check', a));
tool('companion_edit_quest', 'Edit a quest (by id or part of its title): title, deadline (YYYY-MM-DD, makes it a boss), repo, allow keywords, or replace its steps.', { query: z.string(), patch: z.object({ title: z.string().optional(), deadline: z.string().nullable().optional(), repo: z.string().nullable().optional(), allow: z.array(z.string()).optional(), steps: z.array(z.string()).optional() }) }, (a) => call('POST', '/quests/edit', a));
tool('companion_remove_quest', 'Delete a quest by id or part of its title (e.g. one added by mistake).', { query: z.string() }, (a) => call('POST', '/quests/remove', a));
tool('companion_settings', 'Read or change settings. With no arguments it reads them. driftAfterSeconds (90-600: how long a drift lasts before a nudge), quietFrom/quietTo (hours 0-23, nothing speaks in between; null turns it off), morningHour, eveningHour, sound, fx (full-screen effects), volume (0-100).', { driftAfterSeconds: z.number().optional(), quietFrom: z.number().nullable().optional(), quietTo: z.number().nullable().optional(), morningHour: z.number().optional(), eveningHour: z.number().optional(), sound: z.boolean().optional(), fx: z.boolean().optional(), volume: z.number().optional() }, (a) => (Object.keys(a).length ? call('POST', '/settings', a) : call('GET', '/settings')));
tool('companion_rewards', 'Happiness, achievements (with what each unlocks), the wardrobe of unlocked cosmetics and the trophy shelf of beaten deadline bosses.', {}, () => call('GET', '/rewards'));
tool('companion_equip', 'Put an unlocked cosmetic on the creature (shades, cap, headphones, bow, halo, crown), or none.', { item: z.string().nullable() }, (a) => call('POST', '/rewards/equip', a));
tool('companion_week', 'The last 7 days, wins only: steps, XP, flow minutes, sessions, perfect sessions, comebacks, parked ideas, bosses, best day.', {}, () => call('GET', '/week'));
tool('companion_activate_quest', 'Switch the active quest by id or by part of its title.', { query: z.string() }, (a) => call('POST', '/quests/activate', a));
tool('companion_complete_step', 'Mark the next step of the active quest done. Awards XP (comeback bonus if soon after a nudge) and returns level-ups, titles, boss defeats.', {}, () => call('POST', '/steps/done'));
tool('companion_add_steps', 'Append steps to a quest (active quest if no query).', { steps: z.array(z.string()).min(1), query: z.string().optional() }, (a) => call('POST', '/steps/add', a));
tool('companion_pause', 'Pause or resume watching and nudges (e.g. a meeting or a break). With minutes, it resumes by itself (snooze).', { paused: z.boolean(), minutes: z.number().int().min(1).max(480).optional() }, (a) => call('POST', '/pause', a));
tool('companion_feedback', 'Record that the last nudge was wrong (its trigger becomes allowed for this quest) or that the user drifted and the companion missed it (the site/app becomes a distraction for this quest). Pass keyword if the user names the site/app. Returns what was learned; tell the user and offer to undo.', { verdict: z.enum(['wrong-nudge', 'missed-drift']), keyword: z.string().optional() }, (a) => call('POST', '/feedback', a));
tool('companion_rules', "Show the active quest's learned allow/deny keywords and the global distraction list.", {}, () => call('GET', '/rules'));
tool('companion_forget_rule', "Undo a learned rule (remove a keyword from the active quest's allow/deny lists).", { keyword: z.string() }, (a) => call('POST', '/rules/forget', a));
tool('companion_today', "Today's activity: steps done, XP, drift nudges and how many turned around, median return time, titles, bosses defeated.", {}, () => call('GET', '/today'));
tool('companion_stats', 'All-time evidence from real use (n = 1): totals, per-day rows, drifts by hour, judge verdicts. Also writes a standalone stats page and returns its path.', {}, () => call('GET', '/stats'));
tool('companion_session', 'Start a focus session (timer ring around the pet; 25 or 50 min usually) or stop it. A session ends with a short break.', { action: z.enum(['start', 'stop']), minutes: z.number().int().min(5).max(120).optional() }, (a) => call('POST', '/session', a));
tool('companion_park', 'Park a distraction or idea for later instead of following it now (the Vault). With a note it parks that idea (e.g. a new project idea from this chat); without one it parks whatever window the user was just on.', { note: z.string().optional() }, (a) => call('POST', '/vault/park', a));
tool('companion_vault', 'List parked items (newest first) so the user can come back to them at a good time.', {}, () => call('GET', '/vault'));
tool('companion_report', 'Kill-test style report: nudges, wrong ones, missed drifts, catch rate, returns.', {}, async () => (await call('GET', '/report')).report);
tool('companion_import_jarvis', "Import Samir's open JARVIS operations (work/NOW.generated.md) as quests; never duplicates.", {}, () => call('POST', '/import/jarvis', {}));

await server.connect(new StdioServerTransport());
