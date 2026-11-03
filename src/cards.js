// RFID cards (the Nudgling Desk's reader, or `nudgling card <id>` to try it):
// a physical tap does one of a few fixed things. Cards carry only their ID;
// what a card does is set here by the user, never read from the card.
//   focus   start a focus session (25 min)
//   done    finish the next step
//   break   snooze 10 min (with card lock on, the only way to snooze)
//   park    park whatever distracted you
//   quest   start work on a quest: make it active, start the focus ring, open
//           Claude with a kickoff prompt on the clipboard, its links and folder
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const CARD_ACTIONS = ['focus', 'done', 'break', 'park', 'quest'];
const normId = (id) => String(id || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 32);

// Opens things on this PC. Every argument is passed as an array (no shell), and
// only http(s) links and existing folders are opened.
export function defaultLauncher() {
  const run = (cmd, args, env = {}) => { try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } }).unref(); return true; } catch { return false; } };
  return {
    claudeApp: () => run('explorer.exe', ['claude://']),
    clipboard: (text) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value $env:BD_CLIP'], { BD_CLIP: text }),
    url: (u) => /^https?:\/\//i.test(u) && run('explorer.exe', [u]),
    folder: (dir) => !!dir && existsSync(dir) && run('explorer.exe', [dir]),
  };
}

export function kickoffPrompt(quest, step) {
  return [
    `I'm working on: ${quest.title}.`,
    step ? `Next step: ${step.text}.` : '',
    quest.repo ? `Project folder: ${quest.repo}.` : '',
    'Help me with only this; if I ask for anything outside it, check the scope with Nudgling first and suggest parking it.',
  ].filter(Boolean).join(' ');
}

export function createCards({ store, companion, ui, launcher = defaultLauncher(), log = () => {} }) {
  const all = () => store.get().cards || {};
  let pending = null; // an unknown card waiting to be told what it does

  async function startWork(quest) {
    companion.setActiveQuest(quest.id);
    const session = await companion.startSession({ minutes: 25 });
    const step = quest.steps.find((s) => !s.done);
    const prompt = kickoffPrompt(quest, step);
    const opened = { claude: launcher.claudeApp(), clipboard: launcher.clipboard(prompt), links: (quest.links || []).filter((u) => launcher.url(u)).length, folder: launcher.folder(quest.repo) };
    ui.nudge?.({ kind: 'card', message: `Starting "${quest.title}". Claude is opening; your kickoff prompt is on the clipboard.`, nextAction: step ? `Paste it (Ctrl+V), then: ${step.text}` : 'Paste it (Ctrl+V) and name the first tiny step' });
    return { action: 'quest', quest: quest.title, session: session.minutes, opened };
  }

  return {
    async tap(rawId) {
      const id = normId(rawId);
      if (!id) throw new Error('no card id');
      const card = all()[id];
      if (!card) {
        pending = id;
        log('card-new', {});
        ui.nudge?.({ kind: 'card-new', id, message: 'New card! What should it do?', nextAction: 'It does that on every tap.' });
        return { known: false, id };
      }
      log('card', { action: card.action });
      ui.gameEvents?.([{ type: 'card', action: card.action }]);
      switch (card.action) {
        case 'focus': return { action: 'focus', session: await companion.startSession({ minutes: card.minutes || 25 }) };
        case 'done': return { action: 'done', events: companion.completeNextStep() };
        case 'break': return { action: 'break', ...companion.setPaused(true, { minutes: card.minutes || 10, by: 'card' }) };
        case 'park': return { action: 'park', parked: companion.park({}) };
        case 'quest': {
          const quest = store.get().quests.find((q) => q.id === card.questId);
          if (!quest) throw new Error('this card\'s quest was deleted: tap it in the HUD to set it again');
          return startWork(quest);
        }
        default: throw new Error(`unknown card action ${card.action}`);
      }
    },
    // What the last unknown card (or a given one) should do from now on.
    assign({ id = pending, action, questId = null, minutes = null } = {}) {
      const cid = normId(id);
      if (!cid) throw new Error('tap the card first');
      if (!CARD_ACTIONS.includes(action)) throw new Error(`action must be one of ${CARD_ACTIONS.join(', ')}`);
      const qid = action === 'quest' ? questId || store.activeQuest()?.id : null;
      if (action === 'quest' && !store.get().quests.some((q) => q.id === qid)) throw new Error('no quest to tie this card to');
      const card = { action, questId: qid, minutes: Number(minutes) || null, at: Date.now() };
      store.update((st) => ({ ...st, cards: { ...(st.cards || {}), [cid]: card } }));
      if (cid === pending) pending = null;
      log('card-assigned', { action });
      return { id: cid, ...card, quest: qid ? store.get().quests.find((q) => q.id === qid)?.title : null };
    },
    remove(id) {
      const cid = normId(id);
      store.update((st) => { const cards = { ...(st.cards || {}) }; delete cards[cid]; return { ...st, cards }; });
      return { removed: cid };
    },
    list() {
      const quests = store.get().quests;
      return { pending, cards: Object.entries(all()).map(([id, c]) => ({ id, action: c.action, quest: c.questId ? quests.find((q) => q.id === c.questId)?.title || '(deleted)' : null, minutes: c.minutes })) };
    },
  };
}
