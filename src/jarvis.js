// Import Samir's open JARVIS operations (work/NOW.generated.md) as quests,
// so nothing has to be typed twice. Read-only on the vault.
// Each "### P1 · OP-0024 — Title" section owned by samir becomes a quest whose
// first step is its "Next action". Re-importing never duplicates (source id).
import { readFileSync } from 'node:fs';
import { makeQuest } from './core/store.js';

const LANE_TO_SKILL = { commercial: 'Sales', clients: 'Client Work', security: 'Admin', brain: 'Systems', engineering: 'Code', creative: 'Creative', growth: 'Growth' };

export function parseNow(markdown, owner = 'samir') {
  const items = [];
  let cur = null;
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^###\s+(P\d)\s+·\s+(OP-\d+)\s+—\s+(.+)$/);
    if (h) { cur = { priority: h[1], id: h[2], title: h[3].trim() }; items.push(cur); continue; }
    if (/^## /.test(line)) { cur = null; continue; } // "## Done" etc. end the open sections
    if (!cur) continue;
    const lane = line.match(/\*\*Owner \/ lane:\*\*\s*([^/]+)\/\s*(\S+)/);
    if (lane) { cur.owner = lane[1].trim(); cur.lane = lane[2].trim(); }
    const next = line.match(/\*\*Next action:\*\*\s*(.+)$/);
    if (next) cur.next = next[1].trim();
    const review = line.match(/\*\*Updated \/ review:\*\*\s*\S+\s*\/\s*(\d{4}-\d{2}-\d{2})/);
    if (review) cur.review = review[1];
  }
  return items.filter((i) => i.owner === owner && i.next);
}

// Only sections above "## Done" are parsed as open work.
export function openSectionOnly(markdown) {
  const done = markdown.search(/^## Done\b/m);
  return done < 0 ? markdown : markdown.slice(0, done);
}

export function jarvisQuests(markdown, existingQuests = []) {
  const have = new Set(existingQuests.map((q) => q.source).filter(Boolean));
  return parseNow(openSectionOnly(markdown))
    .filter((i) => !have.has(`jarvis:${i.id}`))
    .map((i) => ({
      ...makeQuest({ title: `${i.id} ${i.title}`, tag: LANE_TO_SKILL[i.lane] || 'General', steps: [i.next], deadline: i.review || null, boss: false }),
      source: `jarvis:${i.id}`,
    }));
}

export function importFromFile(file, existingQuests) {
  return jarvisQuests(readFileSync(file, 'utf8'), existingQuests);
}
