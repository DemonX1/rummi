import { isValidMeld, isJoker } from './melds.js';
import { tilePoints } from './melds.js';

// --- Перебор комбинаций из руки ---

function enumerateMelds(hand) {
  const cands = [];
  const real = hand.filter((t) => !isJoker(t));

  // Сеты: одинаковые значения, разные цвета
  const byVal = new Map();
  for (const t of real) {
    if (!byVal.has(t.value)) byVal.set(t.value, []);
    byVal.get(t.value).push(t);
  }
  for (const [val, group] of byVal) {
    const byColor = new Map();
    for (const t of group) if (!byColor.has(t.color)) byColor.set(t.color, t);
    const distinct = [...byColor.values()];
    if (distinct.length >= 3) {
      cands.push({ tiles: distinct.slice(0, 3), value: val * 3 });
      if (distinct.length >= 4) cands.push({ tiles: distinct.slice(0, 4), value: val * 4 });
    }
  }

  // Серии: подряд идущие числа одного цвета
  const byColor = new Map();
  for (const t of real) {
    if (!byColor.has(t.color)) byColor.set(t.color, []);
    byColor.get(t.color).push(t);
  }
  for (const [, tiles] of byColor) {
    const byV = new Map();
    for (const t of tiles) if (!byV.has(t.value)) byV.set(t.value, t);
    const vals = [...byV.keys()].sort((a, b) => a - b);
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 2; j < vals.length; j++) {
        if (vals[j] - vals[j - 1] !== 1) break;
        if (vals[j] - vals[i] + 1 === j - i + 1) {
          const m = [];
          for (let k = i; k <= j; k++) m.push(byV.get(vals[k]));
          cands.push({ tiles: m, value: m.reduce((s, t) => s + t.value, 0) });
        }
      }
    }
  }
  return cands;
}

function findCombosSum(candidates, target) {
  const used = new Set();
  let best = null;
  const dfs = (i, sum, chosen) => {
    if (best) return;
    if (sum >= target) {
      best = chosen.slice();
      return;
    }
    for (let j = i; j < candidates.length && !best; j++) {
      const c = candidates[j];
      if (c.tiles.some((t) => used.has(t.id))) continue;
      c.tiles.forEach((t) => used.add(t.id));
      dfs(j + 1, sum + c.value, chosen.concat([c]));
      c.tiles.forEach((t) => used.delete(t.id));
    }
  };
  dfs(0, 0, []);
  return best;
}

function pickDisjoint(candidates) {
  const used = new Set();
  const chosen = [];
  const sorted = candidates.slice().sort((a, b) => b.tiles.length - a.tiles.length);
  for (const c of sorted) {
    if (c.tiles.some((t) => used.has(t.id))) continue;
    c.tiles.forEach((t) => used.add(t.id));
    chosen.push(c);
  }
  return chosen;
}

function insertTile(meld, tile) {
  for (let i = 0; i <= meld.length; i++) {
    const cand = [...meld];
    cand.splice(i, 0, tile);
    if (isValidMeld(cand)) return cand;
  }
  return null;
}

/**
 * Принять решение за бота.
 * @param game Game
 * @returns { board, hand, melded } если бот выкладывает фишки, либо null если берёт фишку
 */
export function aiDecision(game) {
  const player = game.players[game.turnIndex];
  const difficulty = game.difficulty || 'medium';
  const hand = player.hand.slice();
  const board = game.board.map((m) => m.slice());
  const movedIds = new Set();

  const placeMeld = (tiles) => {
    const ids = new Set(tiles.map((t) => t.id));
    for (let i = hand.length - 1; i >= 0; i--) {
      if (ids.has(hand[i].id)) hand.splice(i, 1);
    }
    for (const t of tiles) movedIds.add(t.id);
    board.push(tiles.slice());
  };

  const extendExisting = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (let h = 0; h < hand.length; h++) {
        const tile = hand[h];
        for (let m = 0; m < board.length; m++) {
          const cand = insertTile(board[m], tile);
          if (cand) {
            board[m] = cand;
            hand.splice(h, 1);
            movedIds.add(tile.id);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
  };

  const createNew = () => {
    let changed = true;
    while (changed) {
      changed = false;
      const cands = enumerateMelds(hand);
      const chosen = pickDisjoint(cands);
      if (chosen.length === 0) break;
      for (const c of chosen) {
        placeMeld(c.tiles);
        changed = true;
      }
    }
  };

  let melded = player.melded;

  if (!melded) {
    const cands = enumerateMelds(hand);
    const combo = findCombosSum(cands, 30);
    if (!combo) return null; // не может сделать первую выкладку — берёт фишку
    for (const c of combo) placeMeld(c.tiles);
    melded = true;
  }

  extendExisting();
  createNew();
  extendExisting();

  if (movedIds.size === 0) return null;

  // «Уровень сложности» бота: с некоторой вероятностью берёт фишку вместо хода
  const passChance = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.15 : 0.0;
  if (Math.random() < passChance) return null;

  return { board, hand, melded };
}
