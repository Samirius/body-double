// Local decision model ("System One" style, e.g. Julia-1 or Kev served by
// llama.cpp's /v1/systemone). It answers one typed question with
// probabilities and never writes text. Same interface as createJudge, so the
// companion (unclear stretches) and the chat check use it unchanged.
//
// Privacy: by default it refuses any endpoint that is not this machine, so
// window titles and chat text never leave the PC. BD_DECIDER_ALLOW_REMOTE=1
// lifts that (e.g. hosted Jev) and is a deliberate choice.
import { createModels, createProvider } from '@earendil-works/pi-ai';
import { typesafeSystemOneApi } from '@earendil-works/pi-ai/api/typesafe-system-one.lazy';

// Two options, no "unsure": measured on eval/decider/cases.json with Julia-1,
// a third "unsure" option absorbed 29 of 40 answers (18% accuracy), while this
// binary wording reached 71% with no false nudges. Uncertainty comes from the
// probability instead (below the threshold = stay quiet).
export function deciderQuestion(questTitle) {
  return {
    fit: {
      type: 'choice',
      instructions: "Is this window part of the user's quest, or something else?",
      criteria: {
        work: `Working on "${questTitle || 'the current task'}": its tools, documents, research or messages about it.`,
        other: 'Something unrelated: entertainment, social media, news, sports, shopping, games, or a different project.',
      },
    },
  };
}
const VERDICT = { work: 'on-task', other: 'off-task' };

export function isLocalUrl(url) {
  try { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname); } catch { return false; }
}

export function createDecider({ baseUrl = 'http://127.0.0.1:18090/v1', modelId = 'julia-1', threshold = 0.75, allowRemote = false, log = () => {}, models: injected = null } = {}) {
  if (!isLocalUrl(baseUrl) && !allowRemote) throw new Error(`decider endpoint ${baseUrl} is not on this machine; set BD_DECIDER_ALLOW_REMOTE=1 to allow it on purpose`);
  const model = {
    type: 'classifier', id: modelId, name: modelId, api: 'typesafe-system-one', provider: 'local-decider',
    baseUrl, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192,
    compat: { imageInput: 'assets', sendImageOptInHeader: false },
  };
  const models = injected || createModels();
  if (!injected) {
    models.setProvider(createProvider({
      id: 'local-decider', name: 'Local decider', baseUrl,
      // llama.cpp ignores the key unless started with --api-key.
      auth: { apiKey: { name: 'local', resolve: async () => ({ auth: { apiKey: 'local' } }) } },
      models: [model],
      classifiers: { 'typesafe-system-one': typesafeSystemOneApi() },
    }));
  }

  return {
    mode: 'local',
    model: modelId,
    threshold,
    // Returns { verdict, reason, source, probability, probabilities, ms }.
    async judge({ quest, nextStep, sample, minutes = 0 }) {
      const started = Date.now();
      const state = {
        quest: quest ? quest.title : '(no quest)',
        next_step: nextStep ? nextStep.text : '',
        app: sample?.app || '',
        window_title: String(sample?.title || '').slice(0, 300),
        // minutes_in_window is deliberately not sent: with Julia-1 that one extra
        // field flipped clear drifts (Netflix, Steam) to 'work' at p~1.0.
      };
      let result;
      try { result = await models.classify(model, { state, questions: deciderQuestion(quest?.title) }); } catch (e) { result = { stopReason: 'error', errorMessage: String(e.message || e) }; }
      const ms = Date.now() - started;
      if (result.stopReason === 'error' || !result.answers?.fit) {
        log('decider-error', { error: String(result.errorMessage || 'no answer').slice(0, 200) });
        return { verdict: 'unsure', reason: 'local decider unavailable', source: 'local', ms };
      }
      const fit = result.answers.fit;
      const p = fit.probabilities?.[fit.choice] ?? fit.confidence ?? 0;
      const choice = VERDICT[fit.choice] || 'unsure';
      // Only act when it is confident; otherwise stay quiet (unsure = no nudge).
      const verdict = choice !== 'unsure' && p >= threshold ? choice : 'unsure';
      return { verdict, choice, reason: `${choice} p=${p.toFixed(2)} (${modelId})`, source: 'local', probability: p, probabilities: fit.probabilities, ms };
    },
  };
}
