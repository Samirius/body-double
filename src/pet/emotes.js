// Pixel emotes shown by the Nudgling's head (no words): fire when it's
// annoyed, "!" when it notices something, a heart when you come back...
// Each is a grid of palette keys; '.' is transparent.
const PAL = { r: '#ff3b3b', o: '#ff8a1e', y: '#ffe23b', w: '#ffffff', k: '#1a1530', p: '#ff4fa3', l: '#ffc2dd', b: '#38b6ff', c: '#bfefff', q: '#00f0ff' };

export const EMOTES = {
  fire: [
    '....r....',
    '...rr...r',
    '...ror..r',
    '..rooor.r',
    '.roooorrr',
    '.rooyoorr',
    'rooyyyoor',
    'rooyyyoor',
    '.rooyyor.',
    '..rrrrr..',
  ],
  alert: [
    '...kkk...',
    '...kyk...',
    '...kyk...',
    '...kyk...',
    '...kyk...',
    '...kkk...',
    '.........',
    '...kkk...',
    '...kyk...',
    '...kkk...',
  ],
  heart: [
    '.........',
    '.pp...pp.',
    'plpp.pppp',
    'ppppppppp',
    'ppppppppp',
    '.ppppppp.',
    '..ppppp..',
    '...ppp...',
    '....p....',
  ],
  sparkle: [
    '....y....',
    '....y....',
    '...ywy...',
    'yyywwwyyy',
    '...ywy...',
    '....y....',
    '....y....',
  ],
  sweat: [
    '....b....',
    '...bb....',
    '..bbcb...',
    '.bbccbb..',
    '.bbbbbb..',
    '..bbbb...',
  ],
  question: [
    '..kkkk...',
    '.kqqqqk..',
    '.kqkkqk..',
    '....kqk..',
    '...kqk...',
    '...kqk...',
    '...kkk...',
    '.........',
    '...kkk...',
    '...kqk...',
    '...kkk...',
  ],
};

// Draws an emote with its bottom-left at (x, y), `px` screen pixels per cell.
export function drawEmote(ctx, name, x, y, px = 3) {
  const grid = EMOTES[name];
  if (!grid) return;
  const h = grid.length;
  for (let r = 0; r < h; r++) for (let c = 0; c < grid[r].length; c++) {
    const key = grid[r][c];
    if (key === '.') continue;
    ctx.fillStyle = PAL[key];
    ctx.fillRect(Math.round(x + c * px), Math.round(y - (h - r) * px), px, px);
  }
}
