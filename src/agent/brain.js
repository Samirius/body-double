// The companion's "voice": a pi agent that turns an event (drift, return,
// stuck) into ONE short message with ONE next action, or splits a step that
// is too big. It never awards XP (see core/game.js) and never sees full
// window titles: only the matched keyword, the quest and recent stats.
// Without a model (no key yet, or a failed call) it falls back to templates,
// so the app always works.
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, Type } from '@earendil-works/pi-ai';

export const SYSTEM_PROMPT = `You are a calm, warm focus companion for someone with ADHD. You speak first when they drift.
Rules for every message:
- Lead with ONE concrete next action they can do in under 2 minutes ("Open the Merchant Center tab", not "get back to work").
- At most 2 short sentences. No guilt, no lectures, no exclamation-mark cheerleading.
- Name their quest so they remember what matters. Never mention XP numbers; the game shows those.
- If the current step is vague or big, call split_step with 2-5 tiny steps instead of nudging toward it.
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

export function templateNudge({ quest, nextStep, event }) {
  const what = quest ? `"${quest.title}"` : 'your quest';
  if (event.type === 'returned') return { message: `Welcome back to ${what}.`, nextAction: nextStep ? nextStep.text : 'Pick the next tiny step' };
  return {
    message: event.nudgeNumber > 1 ? `Still drifting. ${what} is waiting.` : `Quick check: ${what}?`,
    nextAction: nextStep ? nextStep.text : `Open the window you need for ${what}`,
  };
}

export function buildPrompt({ quest, nextStep, event, stats, now = new Date() }) {
  return [
    `Event: ${event.type}${event.type === 'drift' ? ` for ${Math.round(event.driftedSeconds / 60)} min (${event.reason || 'off-task app'}), nudge #${event.nudgeNumber} this episode` : ''}.`,
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
