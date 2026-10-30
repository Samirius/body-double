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
  const [s, q] = await Promise.all([window.bd.act('status'), window.bd.act('quests')]);
  if (!s.ok) { $('err').textContent = s.error; return; }
  $('err').textContent = '';
  const st = s.data;
  drawAvatar(petStage(st.level.level));
  $('level').textContent = `Level ${st.level.level}`;
  $('xpbar').style.width = `${Math.round(st.level.fraction * 100)}%`;
  $('xptext').textContent = `${st.level.into} / ${st.level.needed} XP to level ${st.level.level + 1}`;
  const label = st.paused ? 'paused' : st.label || 'watching';
  $('state').textContent = st.paused && st.pausedUntil ? `snoozed until ${new Date(st.pausedUntil).toTimeString().slice(0, 5)}` : label;
  $('state').className = `pill ${label}`;
  $('a-pause').textContent = st.paused ? 'Resume' : 'Pause';

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

  $('streak').innerHTML = `🔥 <b>${st.streak.days}</b> day${st.streak.days === 1 ? '' : 's'} · 🛡 ${st.streak.shields} shield${st.streak.shields === 1 ? '' : 's'}`;
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

  $('quests').innerHTML = '';
  for (const x of (q.ok ? q.data : [])) {
    const row = document.createElement('div');
    row.className = `quest-row${x.active ? ' active' : ''}`;
    row.innerHTML = '<span></span><small></small>';
    row.firstChild.textContent = x.title;
    row.lastChild.textContent = `${x.done}/${x.total}${x.deadline ? ` · ${daysLeft(x.deadline)}` : ''}`;
    row.onclick = async () => { await window.bd.act('activate', { query: x.id }); refresh(); };
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
window.bd.onRefresh(refresh);
window.bd.onEvent((ev) => { if (ev.type === 'game' || ev.type === 'hello') refresh(); });
setInterval(refresh, 20_000);
refresh();
