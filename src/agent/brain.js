// The companion's "voice": a pi agent that turns an event into ONE short
// message with ONE next action, or splits a step that is too big.
//   events: drift | returned | stuck | morning | evening
// It never awards XP (see core/game.js) and never sees full window titles:
// only the matched keyword, the quest and recent stats. Without a model (no
// key yet, or a failed call) it falls back to templates, so it always works.
//
// The judge is separate: it decides whether a long 'unclear' stretch fits the
// quest. It does see the window title (and optionally a screenshot), because
// that is the whole question; see createJudge for the privacy switch.
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, Type } from '@earendil-works/pi-ai';

export const SYSTEM_PROMPT = `You are a calm, warm focus companion for someone with ADHD. You speak first.
Rules for every message:
- Lead with ONE concrete next action they can do in under 2 minutes ("Open the Merchant Center tab", not "get back to work").
- At most 2 short sentences. No guilt, no lectures, no exclamation-mark cheerleading.
- Name their quest so they remember what matters. If there is no quest, ask them to pick one thing for the next 25 minutes. Never invent XP numbers; the game shows those.
- If the current step is vague or big (or they are stuck), call split_step with 2-5 tiny steps, then nudge toward the first.
- Morning: name today's most urgent quest and its first step. Evening: celebrate what was done, honestly, and name tomorrow's first step.
Always respond by calling a tool: nudge, or split_step followed by nudge.`;

export async function createModelFromEnv(env = process.env) {
  const provider = (env.BD_PROVIDER || (env.META_API_KEY ? 'meta' : env.ZAI_API_KEY ? 'zai' : 'none')).toLowerCase();
  if (provider === 'none') return null;
  const models = createModels();
  if (provider === 'meta') {
    const { metaProvider } = await import('@earendil-works/pi-ai/providers/meta');
    models.setProvider(metaProvider());
    return { models, model: models.getModel('meta', env.BD_MODEL || 'muse-spark-1.3') };
  }
  if (provider === 'zai') {
    const { zaiProvider } = await import('@earendil-works/pi-ai/providers/zai');
    models.setProvider(zaiProvider());
    return { models, model: models.getModel('zai', env.BD_MODEL || 'glm-5.3') };
  }
  throw new Error(`Unknown BD_PROVIDER: ${provider} (use meta, zai or none)`);
}

const mins = (s) => Math.max(1, Math.round(s / 60));

export function templateNudge({ quest, nextStep, event }) {
  const what = quest ? `"${quest.title}"` : 'your quest';
  const step = nextStep ? nextStep.text : null;
  switch (event.type) {
    case 'returned': return { message: `Welcome back to ${what}.`, nextAction: step || 'Pick the next tiny step' };
    case 'stuck': return { message: `${mins(event.onTaskSeconds)} min on this step. Make it smaller?`, nextAction: step ? `Do only the first line of: ${step}` : 'Write the very next tiny action' };
    case 'morning': return { message: event.summary || `Good morning. ${what} is up first.`, nextAction: step || 'Choose today\'s first quest' };
    case 'evening': return { message: event.summary || 'Day done.', nextAction: step ? `Tomorrow, start with: ${step}` : 'Pick tomorrow\'s first step' };
    case 'session-start': return { message: `${event.minutes}:00 on the clock${quest ? ` for ${what}` : ''}. I'll keep watch.`, nextAction: step ? `First, just: ${step}` : 'First, just open what you need' };
    case 'session-end': return { message: `${event.minutes} minutes done. That counts.`, nextAction: `Stand up and drink water (${event.breakMinutes} min break)` };
    case 'break-end': return { message: 'Break over. Back in?', nextAction: step || 'Pick the next tiny step' };
    case 'chat': return { message: `This chat is not about ${what}. Park the idea and come back?`, nextAction: step ? `Save the idea in one line, then: ${step}` : 'Save the idea in one line, then return to your quest' };
    default:
      // Without a quest, "your quest is waiting" means nothing: ask for one thing instead.
      if (!quest) return { message: event.nudgeNumber > 1 ? 'Still drifting, and no quest yet.' : 'No quest yet, and you have drifted a while.', nextAction: 'Pick one thing for the next 25 minutes and tell me' };
      return {
      message: event.nudgeNumber > 1 ? `Still drifting. ${what} is waiting.` : `Quick check: ${what}?`,
      nextAction: step || `Open the window you need for ${what}`,
    };
  }
}

export function buildPrompt({ quest, nextStep, event, stats, now = new Date() }) {
  const what = {
    drift: () => `drift for ${Math.round(event.driftedSeconds / 60)} min (${event.reason || 'off-task app'}), nudge #${event.nudgeNumber} this episode`,
    returned: () => `back on task ${event.secondsAfterNudge}s after a nudge`,
    stuck: () => `on task for ${mins(event.onTaskSeconds)} min without finishing the step (possibly stuck)`,
    morning: () => `start of the day. ${event.summary || ''}`,
    evening: () => `end of the day. ${event.summary || ''}`,
    chat: () => `they are chatting with an AI assistant about something unrelated to the quest (${event.reason || 'off-topic'}); suggest parking the idea in one line`,
  }[event.type]?.() || event.type;
  return [
    `Event: ${what}.`,
    `Local time: ${now.toTimeString().slice(0, 5)}.`,
    quest ? `Current quest: "${quest.title}" (${quest.tag}${quest.deadline ? `, deadline ${quest.deadline}` : ''}).` : 'No active quest.',
    nextStep ? `Next undone step: "${nextStep.text}".` : 'No steps left or none defined.',
    `What has worked: ${stats.sent} nudges sent, ${stats.returned} led to a return${stats.returnSeconds.length ? `, median ${median(stats.returnSeconds)} s to return` : ''}.`,
  ].join('\n');
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function createBrain({ modelHandle = null, onNudge, onSplit, log = () => {} }) {
  const tools = [
    {
      name: 'nudge', label: 'Nudge',
      description: 'Show the user one short message and one next action (under 2 minutes).',
      parameters: Type.Object({ message: Type.String({ maxLength: 200 }), nextAction: Type.String({ maxLength: 120 }) }),
      execute: async (_id, p) => { await onNudge(p, 'model'); return { content: [{ type: 'text', text: 'shown' }], details: p, terminate: true }; },
    },
    {
      name: 'split_step', label: 'Split step',
      description: 'Replace the current step with 2-5 tiny concrete steps, in order.',
      parameters: Type.Object({ steps: Type.Array(Type.String({ maxLength: 120 }), { minItems: 2, maxItems: 5 }) }),
      execute: async (_id, p) => { await onSplit(p.steps); return { content: [{ type: 'text', text: 'split; now call nudge for the first new step' }], details: p }; },
    },
  ];

  return {
    hasModel: !!modelHandle,
    async handle({ quest, nextStep, event, stats }) {
      if (!modelHandle) return onNudge(templateNudge({ quest, nextStep, event }), 'template');
      let nudged = false;
      const agent = new Agent({
        initialState: { systemPrompt: SYSTEM_PROMPT, model: modelHandle.model, tools: tools.map((t) => (t.name === 'nudge' ? { ...t, execute: async (...a) => { nudged = true; return t.execute(...a); } } : t)) },
        streamFn: modelHandle.models.streamSimple.bind(modelHandle.models),
        identity: { attribution: null },
      });
      try {
        await agent.prompt(buildPrompt({ quest, nextStep, event, stats }));
        if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      } catch (e) {
        log('model-error', { error: String(e.message || e).slice(0, 200) });
      }
      if (!nudged) await onNudge(templateNudge({ quest, nextStep, event }), 'template-fallback');
    },
  };
}

// --- judge -------------------------------------------------------------------
// mode: 'title' (default when a model exists): send app + window title.
//       'screenshot': also send a downscaled screenshot, only if the model
//       accepts images. Nothing is stored either way.
//       'off': never judge; unclear stays unclear.
export const JUDGE_PROMPT = `You decide whether what the user is looking at plausibly belongs to their current quest.
Be conservative: answer "off-task" only when it is clearly unrelated leisure or a different project; answer "unsure" when it could reasonably be research, communication or tooling for the quest.
Respond only by calling the verdict tool.`;

export function createJudge({ modelHandle = null, mode = 'title', log = () => {} }) {
  const canSee = !!modelHandle?.model?.input?.includes?.('image');
  const effective = !modelHandle || mode === 'off' ? 'off' : mode === 'screenshot' && canSee ? 'screenshot' : 'title';
  return {
    mode: effective,
    async judge({ quest, nextStep, sample, minutes, screenshot = null }) {
      if (effective === 'off') return { verdict: 'unsure', reason: 'judge off', source: 'off' };
      let result = null;
      const verdictTool = {
        name: 'verdict', label: 'Verdict',
        description: 'Give the verdict.',
        parameters: Type.Object({ verdict: Type.Union([Type.Literal('on-task'), Type.Literal('off-task'), Type.Literal('unsure')]), reason: Type.String({ maxLength: 160 }) }),
        execute: async (_id, p) => { result = p; return { content: [{ type: 'text', text: 'ok' }], details: p, terminate: true }; },
      };
      const agent = new Agent({
        initialState: { systemPrompt: JUDGE_PROMPT, model: modelHandle.model, tools: [verdictTool] },
        streamFn: modelHandle.models.streamSimple.bind(modelHandle.models),
        identity: { attribution: null },
      });
      const text = [
        quest ? `Quest: "${quest.title}" (${quest.tag}).` : 'No active quest.',
        nextStep ? `Next step: "${nextStep.text}".` : '',
        `For the last ${minutes} min they have been in app "${sample.app}" with window title "${sample.title.slice(0, 160)}".`,
      ].filter(Boolean).join('\n');
      try {
        const images = effective === 'screenshot' && screenshot ? [{ type: 'image', data: screenshot, mimeType: 'image/png' }] : undefined;
        await agent.prompt(text, images);
        if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      } catch (e) { log('judge-error', { error: String(e.message || e).slice(0, 200) }); }
      return result ? { ...result, source: effective } : { verdict: 'unsure', reason: 'no verdict', source: effective };
    },
  };
}
