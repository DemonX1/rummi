import { isValidMeld, sortMeld, isJoker, tilePoints } from './melds.js';

const FIRST_MELD_TARGET = 30;

// Детерминированный ГПСЧ (mulberry32) — для тестов: aiDecision(game, { rng: makeRng(seed) })
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(tiles) {
  let sum = 0;
  for (const t of tiles) sum += tilePoints(t);
  return { tiles, size: tiles.length, sum };
}

function dedupe(cands) {
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    const key = c.tiles.map((t) => t.id).sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

// --- Перебор комбинаций ---

// Базовое перечисление без джокеров (уровень easy). Джокеры игнорируются.
function enumerateBasic(tiles) {
  const hand = tiles.filter((t) => !isJoker(t));
  const cands = [];

  const byVal = new Map();
  for (const t of hand) {
    if (!byVal.has(t.value)) byVal.set(t.value, []);
    byVal.get(t.value).push(t);
  }
  for (const [, group] of byVal) {
    const byColor = new Map();
    for (const t of group) if (!byColor.has(t.color)) byColor.set(t.color, t);
    const distinct = [...byColor.values()];
    if (distinct.length >= 3) {
      cands.push(mk(distinct.slice(0, 3)));
      if (distinct.length >= 4) cands.push(mk(distinct.slice(0, 4)));
    }
  }

  const byColor = new Map();
  for (const t of hand) {
    if (!byColor.has(t.color)) byColor.set(t.color, []);
    byColor.get(t.color).push(t);
  }
  for (const [, arr] of byColor) {
    const byV = new Map();
    for (const t of arr) if (!byV.has(t.value)) byV.set(t.value, t);
    const vals = [...byV.keys()].sort((a, b) => a - b);
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 2; j < vals.length; j++) {
        if (vals[j] - vals[j - 1] !== 1) break;
        if (vals[j] - vals[i] !== j - i) continue; // весь диапазон значений должен идти подряд
        const m = [];
        for (let k = i; k <= j; k++) m.push(byV.get(vals[k]));
        cands.push(mk(m));
      }
    }
  }
  return cands;
}

// Перечисление с джокерами: недостающие фишки сетов и серий закрываются джокерами из набора.
function enumerateWithJokers(tiles) {
  const real = tiles.filter((t) => !isJoker(t));
  const jokers = tiles.filter(isJoker);
  const jn = jokers.length;
  const cands = [...enumerateBasic(real)];
  if (jn === 0) return dedupe(cands);

  // Сеты: реальные фишки разных цветов одного числа + джокеры до размера 3–4
  const byVal = new Map();
  for (const t of real) {
    if (!byVal.has(t.value)) byVal.set(t.value, []);
    byVal.get(t.value).push(t);
  }
  for (const [, group] of byVal) {
    const byColor = new Map();
    for (const t of group) if (!byColor.has(t.color)) byColor.set(t.color, t);
    const distinct = [...byColor.values()];
    if (distinct.length === 0) continue;
    for (let jU = 1; jU <= jn; jU++) {
      const base = Math.min(distinct.length, 4 - jU);
      if (base < 1 || base + jU < 3) continue;
      cands.push(mk([...distinct.slice(0, base), ...jokers.slice(0, jU)]));
    }
  }

  // Серии: окно [lo..hi] одного цвета, дырки (включая продления за края) — джокерами
  const byColor = new Map();
  for (const t of real) {
    if (!byColor.has(t.color)) byColor.set(t.color, new Map());
    const m = byColor.get(t.color);
    if (!m.has(t.value)) m.set(t.value, t);
  }
  for (const [, byV] of byColor) {
    for (let lo = 1; lo <= 13; lo++) {
      let gaps = 0;
      for (let hi = lo; hi <= 13; hi++) {
        if (!byV.has(hi)) gaps++;
        if (gaps > jn) break;
        const len = hi - lo + 1;
        if (len >= 3 && len - gaps >= 1) {
          const m = [];
          let usedJ = 0;
          for (let v = lo; v <= hi; v++) {
            const tile = byV.get(v);
            if (tile) m.push(tile);
            else m.push(jokers[usedJ++]);
          }
          cands.push(mk(m));
        }
      }
    }
  }
  return dedupe(cands);
}

// Жадный подбор непересекающихся комбинаций: максимум фишек, тайбрейк — сумма.
function pickDisjoint(cands) {
  const used = new Set();
  const chosen = [];
  const sorted = cands.slice().sort((a, b) => b.size - a.size || b.sum - a.sum);
  for (const c of sorted) {
    if (c.tiles.some((t) => used.has(t.id))) continue;
    c.tiles.forEach((t) => used.add(t.id));
    chosen.push(c);
  }
  return chosen;
}

// Легаси-поиск первого найденного набора на target очков (уровень easy).
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
      dfs(j + 1, sum + c.sum, chosen.concat([c]));
      c.tiles.forEach((t) => used.delete(t.id));
    }
  };
  dfs(0, 0, []);
  return best;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// Оптимизатор первой выкладки: среди наборов на 30+ выбирает по критериям
// (минимум джокеров, максимум фишек, максимум суммы). Ограничен бюджетом узлов.
function bestFirstCombo(cands, nodeBudget = 6000) {
  let best = null;
  let nodes = nodeBudget;
  const state = { chosen: [], used: new Set(), sum: 0, cnt: 0, jok: 0 };
  const dfs = (i) => {
    if (nodes-- <= 0) return;
    if (state.sum >= FIRST_MELD_TARGET) {
      const score = [-state.jok, state.cnt, state.sum];
      if (!best || lexLess(best.score, score)) best = { combo: state.chosen.slice(), score };
    }
    for (let j = i; j < cands.length; j++) {
      const c = cands[j];
      if (c.tiles.some((t) => state.used.has(t.id))) continue;
      const cj = c.tiles.reduce((s, t) => s + (isJoker(t) ? 1 : 0), 0);
      c.tiles.forEach((t) => state.used.add(t.id));
      state.chosen.push(c);
      state.sum += c.sum;
      state.cnt += c.size;
      state.jok += cj;
      dfs(j + 1);
      state.chosen.pop();
      state.sum -= c.sum;
      state.cnt -= c.size;
      state.jok -= cj;
      c.tiles.forEach((t) => state.used.delete(t.id));
      if (nodes <= 0) return;
    }
  };
  dfs(0);
  return best ? best.combo : null;
}

function insertTile(meld, tile) {
  for (let i = 0; i <= meld.length; i++) {
    const cand = [...meld];
    cand.splice(i, 0, tile);
    if (isValidMeld(cand)) return cand;
  }
  return null;
}

// --- Манипуляции столом (уровень hard) ---

// Сколько раз пробуем растворить группу(ы) и перекроить заново.
const MANIP_ATTEMPTS = 48;
// Бюджет узлов перебора на одно перекраивание. Всё детерминировано: никаких таймеров.
const COVER_NODES = 2500;

/**
 * Перекроить пул так, чтобы покрыть все обязательные фишки (растворённая группа),
 * максимизировав число использованных фишек руки. Возвращает массив групп либо null.
 */
function coverSearch(pool, mustIds, nodeBudget = COVER_NODES) {
  const must = new Set(mustIds);
  const mustArr = [...must];
  const cands = dedupe(enumerateWithJokers(pool));
  const handIds = new Set(pool.filter((t) => !must.has(t.id)).map((t) => t.id));

  // Порядок кандидатов фиксирован: больше обязательных, потом больше фишек руки
  const entries = cands
    .map((c) => ({
      c,
      cov: c.tiles.reduce((s, t) => s + (must.has(t.id) ? 1 : 0), 0),
      hnd: c.tiles.reduce((s, t) => s + (handIds.has(t.id) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.cov - a.cov || b.hnd - a.hnd);

  const byMust = new Map();
  entries.forEach((e, i) => {
    for (const t of e.c.tiles) {
      if (!must.has(t.id)) continue;
      if (!byMust.has(t.id)) byMust.set(t.id, []);
      byMust.get(t.id).push(i);
    }
  });
  for (const id of mustArr) {
    if (!byMust.has(id)) return null; // фишку нечем покрыть — перекраивание невозможно
  }

  let best = null;
  let nodes = nodeBudget;
  const usedTiles = new Set();

  const tryExtend = (handUsed, chosen) => {
    // Всё покрыто: добираем группы ради дополнительных фишек руки
    for (const e of entries) {
      if (e.hnd === 0) continue;
      if (nodes-- <= 0) return;
      if (e.c.tiles.some((t) => usedTiles.has(t.id))) continue;
      e.c.tiles.forEach((t) => usedTiles.add(t.id));
      chosen.push(e);
      if (handUsed + e.hnd > (best ? best.handUsed : -1)) {
        best = { melds: chosen.map((x) => sortMeld(x.c.tiles)), handUsed: handUsed + e.hnd };
      }
      tryExtend(handUsed + e.hnd, chosen);
      chosen.pop();
      e.c.tiles.forEach((t) => usedTiles.delete(t.id));
    }
  };

  const dfs = (coveredCount, handUsed, chosen) => {
    if (nodes-- <= 0) return;
    if (coveredCount === must.size) {
      if (handUsed > (best ? best.handUsed : -1)) {
        best = { melds: chosen.map((e) => sortMeld(e.c.tiles)), handUsed };
      }
      tryExtend(handUsed, chosen);
      return;
    }
    let target = null;
    for (const id of mustArr) {
      if (!usedTiles.has(id)) {
        target = id;
        break;
      }
    }
    if (!target) return;
    for (const i of byMust.get(target)) {
      const e = entries[i];
      if (e.c.tiles.some((t) => usedTiles.has(t.id))) continue;
      const add = e.c.tiles.reduce((s, t) => s + (must.has(t.id) && !usedTiles.has(t.id) ? 1 : 0), 0);
      e.c.tiles.forEach((t) => usedTiles.add(t.id));
      chosen.push(e);
      dfs(coveredCount + add, handUsed + e.hnd, chosen);
      chosen.pop();
      e.c.tiles.forEach((t) => usedTiles.delete(t.id));
      if (nodes <= 0) return;
    }
  };

  dfs(0, 0, []);
  return best;
}

function dissolveAt(board, idxs) {
  const removed = [];
  const rest = board.filter((_, i) => {
    if (idxs.includes(i)) {
      removed.push(...board[i]);
      return false;
    }
    return true;
  });
  return { rest, removed };
}

/**
 * Локальный поиск манипуляций: растворяем одну (на hard — также две соседние
 * или весь малый стол) группу и перекраиваем «старые + рука», кладя больше своих фишек.
 * Возвращает { board, hand } — обновлённые копии (без изменений, если улучшений нет).
 */
function tryManipulate(board, unplacedHand, full = false) {
  let curBoard = board.map((m) => m.slice());
  let curHand = unplacedHand.slice();

  const rebuild = (rest, removed) => {
    if (!removed.length) return null;
    const pool = [...removed, ...curHand];
    const sol = coverSearch(pool, removed.map((t) => t.id));
    if (!sol || sol.handUsed < 1) return null;
    const solIds = new Set(sol.melds.flat().map((t) => t.id));
    const nextHand = curHand.filter((t) => !solIds.has(t.id));
    return { board: [...rest, ...sol.melds], hand: nextHand };
  };

  const flatLen = () => curBoard.reduce((s, m) => s + m.length, 0);
  let attempts = MANIP_ATTEMPTS;
  let improved = true;
  while (improved && attempts > 0) {
    improved = false;
    const plan = [...Array(curBoard.length).keys()].map((i) => [i]);
    if (full) {
      if (flatLen() <= 12 && curBoard.length > 1) plan.unshift(curBoard.map((_, i) => i)); // полная пересборка маленького стола
      for (let i = 0; i + 1 < curBoard.length; i++) plan.push([i, i + 1]); // соседние пары
    }

    for (const idxs of plan) {
      if (attempts-- <= 0) break;
      const { rest, removed } = dissolveAt(curBoard, idxs);
      const res = rebuild(rest, removed);
      if (res) {
        curBoard = res.board;
        curHand = res.hand;
        improved = true;
        break;
      }
    }
  }
  return { board: curBoard, hand: curHand };
}

/**
 * Принять решение за бота.
 * @param game Game
 * @param opts { rng } — ГПСЧ для вероятностных решений (по умолчанию Math.random)
 * @returns { board, hand } если бот выкладывает фишки, либо null если берёт фишку
 */
export function aiDecision(game, opts = {}) {
  const rng = opts.rng || Math.random;
  const difficulty = game.difficulty || 'medium';
  const player = game.players[game.turnIndex];
  let hand = player.hand.slice();
  let board = game.board.map((m) => m.slice());
  const movedIds = new Set();
  const firstTurn = !player.melded;

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

  const createNew = (enumFn) => {
    let changed = true;
    while (changed) {
      changed = false;
      const chosen = pickDisjoint(enumFn(hand));
      if (chosen.length === 0) break;
      for (const c of chosen) {
        placeMeld(c.tiles);
        changed = true;
      }
    }
  };

  const enumFn = difficulty === 'easy' ? enumerateBasic : enumerateWithJokers;

  if (firstTurn) {
    // В ход первой выкладки манипуляции запрещены: только фишки с руки на 30+
    const combo =
      difficulty === 'easy'
        ? findCombosSum(enumerateBasic(hand), FIRST_MELD_TARGET)
        : bestFirstCombo(enumerateWithJokers(hand));
    if (!combo) return null;
    for (const c of combo) placeMeld(c.tiles);
  } else {
    extendExisting();
    createNew(enumFn);
    extendExisting();

    if (difficulty !== 'easy') {
      // medium — лёгкие манипуляции (растворение одной группы),
      // hard — полный арсенал: пары групп и пересборка малого стола
      const res = tryManipulate(board, hand, difficulty === 'hard');
      if (res.hand.length < hand.length) {
        const onBoard = new Set(res.board.flat().map((t) => t.id));
        for (const t of hand) if (onBoard.has(t.id)) movedIds.add(t.id);
        hand = res.hand;
        board = res.board;
      }
    }
  }

  if (movedIds.size === 0) return null;

  // Ход, опустошающий руку, не пропускается ни на одном уровне сложности
  const winsNow = hand.length === 0;
  const passChance = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.15 : 0;
  if (!winsNow && rng() < passChance) return null;

  return { board, hand };
}
