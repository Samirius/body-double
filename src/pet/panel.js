// Progress panel renderer.
import { buildFrame } from './sprites.js';
import { petStage, levelProgress, TITLES } from '../core/game.js';

const $ = (id) => document.getElementById(id);
const titleName = Object.fromEntries(TITLES.map((t) => [t.id, t.name]));
const median = (xs) => { if (!xs?.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const fmtSecs = (s) => (s == null ? '–' : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);

function drawAvatar(stage) {
  const ctx = $('avatar').getContext('2d');
  const f = buildFrame({ state: 'idle', stage, t: 0.3 });
  ctx.clearRect(0, 0, 24, 24);
  f.pixels.forEach((row, y) => row.forEach((k, x) => { if (k) { ctx.fillStyle = f.palette[k]; ctx.fillRect(x, y, 1, 1); } }));
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const d = Math.ceil((new Date(`${deadline}T23:59:59`) - Date.now()) / 86_400_000);
  return d < 0 ? 'overdue' : d === 0 ? 'due today' : `${d} day${d === 1 ? '' : 's'} left`;
}

async function refresh() {
  const [s, q, v] = await Promise.all([window.bd.act('status'), window.bd.act('quests'), window.bd.act('vault')]);
  if (!s.ok) { $('err').textContent = s.error; return; }
  $('err').textContent = '';
  const st = s.data;
  drawAvatar(petStage(st.level.level));
  $('level').textContent = `LV ${String(st.level.level).padStart(2, '0')}`;
  $('xpbar').style.width = `${Math.round(st.level.fraction * 100)}%`;
  $('xptext').textContent = `${st.level.into} / ${st.level.needed} XP to level ${st.level.level + 1}`;
  const label = st.paused ? 'paused' : st.label || 'watching';
  $('state').textContent = st.paused && st.pausedUntil ? `snoozed until ${new Date(st.pausedUntil).toTimeString().slice(0, 5)}` : label;
  $('state').className = `pill ${label}`;
  $('a-pause').textContent = st.paused ? 'Resume' : 'Pause';
  // Until the user opens or closes it themselves, the form follows the state:
  // open when there is no quest (the obvious next thing), closed otherwise.
  if (!formTouched) $('new-quest').open = !st.quest;

  const quest = st.quest;
  const active = q.ok ? q.data.find((x) => x.active) : null;
  $('quest-title').textContent = quest ? quest.title : 'No active quest';
  $('quest-meta').textContent = active ? [active.tag, active.deadline && daysLeft(active.deadline), `${active.done}/${active.total} steps`].filter(Boolean).join(' · ') : 'Tell Claude what you are working on, or import JARVIS quests.';
  $('next-step').textContent = quest?.next || (quest ? 'All steps done 🎉' : '—');
  $('a-done').disabled = !quest?.next;
  if (quest?.boss) {
    $('boss').style.display = 'block';
    $('hpbar').style.width = `${Math.round((quest.boss.hp / quest.boss.max) * 100)}%`;
    $('hptext').textContent = quest.boss.hp ? `Boss HP ${quest.boss.hp}/${quest.boss.max}` : 'Boss defeated';
  } else $('boss').style.display = 'none';

  $('streak').innerHTML = `STREAK <b>${String(st.streak.days).padStart(2, '0')}D</b> · SHIELD ×${st.streak.shields}`;
  const skills = Object.entries(st.skills).sort((a, b) => b[1] - a[1]);
  $('skills').innerHTML = skills.length ? '' : 'Finish a step to start levelling skills.';
  for (const [name, xp] of skills) {
    const p = levelProgress(xp);
    const el = document.createElement('div');
    el.className = 'skill';
    el.innerHTML = `<span></span><span>Lv ${p.level}</span><div class="bar small"><i style="width:${Math.round(p.fraction * 100)}%"></i></div>`;
    el.firstChild.textContent = name;
    $('skills').appendChild(el);
  }
  $('titles').innerHTML = st.titles.length ? '' : '<span class="muted">None yet. Your first step earns one.</span>';
  for (const t of st.titles) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = titleName[t] || t; $('titles').appendChild(c); }
  $('n-sent').textContent = st.nudges.sent;
  $('n-back').textContent = st.nudges.returned;
  $('n-med').textContent = fmtSecs(median(st.nudges.returnSeconds));

  $('vault').innerHTML = '';
  const items = v.ok ? v.data.slice(0, 8) : [];
  if (!items.length) $('vault').innerHTML = '<span class="muted">Nothing parked. Hit PARK IT on a nudge to save a rabbit hole for later.</span>';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'vault-row';
    row.innerHTML = '<span></span><small></small><button title="Done with it">✓</button>';
    row.children[0].textContent = item.note || item.title || item.key;
    row.children[1].textContent = new Date(item.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    row.children[2].onclick = async () => { await window.bd.act('unpark', { id: item.id }); refresh(); };
    $('vault').appendChild(row);
  }
  $('quests').innerHTML = '';
  for (const x of (q.ok ? q.data : [])) {
    const row = document.createElement('div');
    row.className = `quest-row${x.active ? ' active' : ''}`;
    row.innerHTML = '<span></span><small></small><button class="mini" title="Rename">✎</button><button class="mini" title="Delete">✕</button>';
    const [name, info, edit, del] = row.children;
    name.textContent = x.title;
    info.textContent = `${x.done}/${x.total}${x.deadline ? ` · ${daysLeft(x.deadline)}` : ''}`;
    row.onclick = async () => { await window.bd.act('activate', { query: x.id }); refresh(); };
    // Rename inline (Enter saves, Esc cancels).
    edit.onclick = (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.value = x.title; input.maxLength = 120; input.className = 'inline-edit';
      input.onclick = (ev) => ev.stopPropagation();
      input.onkeydown = async (ev) => {
        if (ev.key === 'Escape') return refresh();
        if (ev.key !== 'Enter' || !input.value.trim()) return;
        await window.bd.act('quest-rename', { query: x.id, title: input.value.trim() });
        refresh();
      };
      name.replaceWith(input); input.focus(); input.select();
    };
    // Delete: a second click within 3 s confirms.
    del.onclick = async (e) => {
      e.stopPropagation();
      if (del.dataset.armed) { await window.bd.act('quest-remove', { query: x.id }); refresh(); return; }
      del.dataset.armed = '1'; del.textContent = 'sure?';
      setTimeout(() => { delete del.dataset.armed; del.textContent = '✕'; }, 3000);
    };
    $('quests').appendChild(row);
  }
  if (q.ok && !q.data.length) $('quests').innerHTML = '<div class="muted">No quests yet.</div>';
}

const run = (name, payload) => async () => { const r = await window.bd.act(name, payload); if (!r.ok) $('err').textContent = r.error; refresh(); };
$('a-done').onclick = run('done');
$('a-snooze').onclick = run('snooze', { minutes: 10 });
$('a-pause').onclick = run('pause-toggle');
$('a-import').onclick = run('import');
$('a-stats').onclick = run('stats');
$('close').onclick = () => window.bd.act('panel');

// Rewards card: mood, wardrobe (unlocked cosmetics), achievements, trophies, this week.
async function refreshRewards() {
  const [r, w] = await Promise.all([window.bd.act('rewards'), window.bd.act('week')]);
  if (r.ok) {
    const d = r.data;
    $('joy-label').textContent = `Mood: ${d.mood} · ${d.achievements.filter((a) => a.unlocked).length}/${d.achievements.length} achievements`;
    $('joy').style.width = `${d.happiness}%`;
    $('wardrobe').innerHTML = '';
    for (const item of [{ id: null, name: 'Nothing', unlocked: true, equipped: !d.equipped }, ...d.wardrobe]) {
      const b = document.createElement('button');
      b.textContent = item.name; b.disabled = !item.unlocked; b.className = item.equipped ? 'on' : '';
      b.title = item.unlocked ? 'Wear it' : 'Earn the matching achievement to unlock';
      b.onclick = async () => { await window.bd.act('equip', { item: item.id }); refreshRewards(); };
      $('wardrobe').appendChild(b);
    }
    $('achievements').innerHTML = '';
    for (const a of d.achievements) {
      const row = document.createElement('div');
      row.className = a.unlocked ? '' : 'locked';
      row.innerHTML = '<b></b> <small></small>';
      row.firstChild.textContent = `${a.unlocked ? '★' : '☆'} ${a.name}`;
      row.lastChild.textContent = `${a.desc}${a.unlocks ? ` → ${a.unlocks}` : ''}`;
      $('achievements').appendChild(row);
    }
    $('trophies').textContent = d.trophies.length ? `Trophy shelf: ${d.trophies.map((t) => `🏆 ${t.quest}`).join(' · ')}` : 'Trophy shelf: beat a deadline boss to place the first one.';
  }
  if (w.ok) {
    const x = w.data;
    const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    $('week').textContent = `This week: ${n(x.steps, 'step')} · ${x.flowMinutes} min of flow · ${x.perfectSessions}/${n(x.sessions, 'session')} perfect · ${n(x.comebacks, 'comeback')} · ${n(x.parked, 'idea')} parked${x.bestDay ? ` · best day ${x.bestDay.day} (${n(x.bestDay.steps, 'step')})` : ''}`;
  }
}

// Settings card: saved in the service on every change (creature and agents see it too).
const showSettings = (s) => {
  $('s-delay').value = s.driftAfterSeconds; $('s-delay-v').textContent = `${Math.round(s.driftAfterSeconds / 6) / 10} min`;
  $('s-qfrom').value = s.quietFrom ?? ''; $('s-qto').value = s.quietTo ?? '';
  $('s-morning').value = s.morningHour; $('s-evening').value = s.eveningHour;
  $('s-volume').value = s.volume; $('s-volume-v').textContent = `${s.volume}%`;
  $('s-sound').checked = s.sound; $('s-fx').checked = s.fx; $('s-lock').checked = s.cardLock;
};
window.bd.act('get-settings').then((r) => r.ok && showSettings(r.data));
const saveSetting = (key, read) => async () => { const r = await window.bd.act('settings', { [key]: read() }); if (r.ok) showSettings(r.data); };
const num = (id) => () => ($(id).value === '' ? null : Number($(id).value));
$('s-delay').oninput = () => { $('s-delay-v').textContent = `${Math.round($('s-delay').value / 6) / 10} min`; };
$('s-delay').onchange = saveSetting('driftAfterSeconds', num('s-delay'));
$('s-qfrom').onchange = saveSetting('quietFrom', num('s-qfrom'));
$('s-qto').onchange = saveSetting('quietTo', num('s-qto'));
$('s-morning').onchange = saveSetting('morningHour', num('s-morning'));
$('s-evening').onchange = saveSetting('eveningHour', num('s-evening'));
$('s-volume').oninput = () => { $('s-volume-v').textContent = `${$('s-volume').value}%`; };
$('s-volume').onchange = saveSetting('volume', num('s-volume'));
$('s-sound').onchange = saveSetting('sound', () => $('s-sound').checked);
$('s-fx').onchange = saveSetting('fx', () => $('s-fx').checked);
$('s-lock').onchange = saveSetting('cardLock', () => $('s-lock').checked);

// AI card: the model chain, and "Sign in with Meta" (Muse Spark, no key needed).
const showAi = (s) => {
  const chain = !s.models || /^templates/.test(s.models) ? '' : `${s.models.replace(/llama-local\/llama-3\.2-3b/, 'Llama 3.2 3B (this PC)').replace(/meta\/muse-spark[\w.-]*/, 'Muse Spark (Meta)').replace(/ -> /g, '  →  ')}  →  `;
  $('ai-models').textContent = `${chain}built-in messages`;
  $('a-meta').textContent = s.signedIn ? 'Sign out of Meta' : 'Sign in with Meta';
  if (s.lastError && !s.signedIn) $('ai-code').textContent = `Meta sign-in failed: ${s.lastError}`;
};
const refreshAi = async () => { const r = await window.bd.act('meta-status'); if (r.ok) showAi(r.data); return r.ok ? r.data : null; };
refreshAi();
let metaPoll = null;
$('a-meta').onclick = async () => {
  const s = await refreshAi();
  if (s?.signedIn) { const r = await window.bd.act('meta-logout'); if (r.ok) { $('ai-code').textContent = 'Signed out of Meta.'; refreshAi(); } return; }
  $('ai-code').textContent = 'Asking Meta for a code…';
  const r = await window.bd.act('meta-login');
  if (!r.ok) { $('ai-code').textContent = `Meta sign-in failed: ${r.error}`; return; }
  $('ai-code').innerHTML = 'Enter this code on the Meta page that just opened: <b></b>';
  $('ai-code').querySelector('b').textContent = r.data.userCode;
  clearInterval(metaPoll);
  const until = Date.now() + (r.data.expiresInSeconds || 600) * 1000;
  metaPoll = setInterval(async () => {
    const st = await refreshAi();
    if (st?.signedIn) { clearInterval(metaPoll); $('ai-code').textContent = 'Muse Spark connected. It writes your nudges now.'; }
    else if (st?.lastError || Date.now() > until) { clearInterval(metaPoll); }
  }, 3000);
};

// Connect Claude: adds the companion's tools to Claude Code (a second click removes them).
const showClaude = (connected) => { $('a-claude').textContent = connected ? 'Claude: connected ✓' : 'Connect Claude'; $('a-claude').title = connected ? 'Click to disconnect' : 'Adds the companion tools to Claude Code (backs up ~/.claude.json first)'; };
window.bd.act('claude-status').then((r) => r.ok && showClaude(r.data.connected));
$('a-claude').onclick = async () => {
  const r = await window.bd.act('connect-claude');
  if (!r.ok) { $('err').textContent = r.error; return; }
  showClaude(r.data.connected);
  $('err').textContent = r.data.connected ? 'Connected. Start a new Claude chat to use it.' : 'Disconnected from Claude.';
};

let formTouched = false;
// Only a real click counts as "touched"; programmatic open/close does not.
$('new-quest').querySelector('summary').addEventListener('click', () => { formTouched = true; });
$('quest-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = (v, sep) => v.split(sep).map((x) => x.trim()).filter(Boolean);
  const payload = {
    title: $('q-title').value.trim(),
    steps: list($('q-steps').value, /\r?\n/),
    deadline: $('q-deadline').value || null,
    tag: $('q-tag').value,
    allow: list($('q-allow').value, ','),
  };
  if (!payload.title) return;
  const r = await window.bd.act('add-quest', payload);
  if (!r.ok) { $('err').textContent = r.error; return; }
  $('quest-form').reset();
  $('new-quest').open = false;
  formTouched = false;
  refresh();
});
window.bd.onRefresh(() => { refresh(); refreshRewards(); });
refreshRewards();
window.bd.onEvent((ev) => { if (ev.type === 'game' || ev.type === 'hello') refresh(); });
setInterval(refresh, 20_000);
refresh();
