export const COLORS = ['R', 'B', 'K', 'Y'];

export const isJoker = (t) => t.color === 'JOKER';

export const tilePoints = (t) => (isJoker(t) ? 30 : t.value);

export const tileValue = tilePoints;

export const COLOR_NAME = { R: 'Красные', B: 'Синие', K: 'Чёрные', Y: 'Жёлтые' };

export function createDeck() {
  const tiles = [];
  let id = 0;
  for (const color of COLORS) {
    for (let v = 1; v <= 13; v++) {
      tiles.push({ id: id++, color, value: v });
      tiles.push({ id: id++, color, value: v });
    }
  }
  tiles.push({ id: id++, color: 'JOKER', value: 0 });
  tiles.push({ id: id++, color: 'JOKER', value: 0 });
  return tiles;
}

// Проверка, что набор фишек образует корректную группу (комбо или серию).
// Джокер (JOKER) может заменять любую фишку.
export function isValidMeld(tiles) {
  const n = tiles.length;
  if (!Array.isArray(tiles) || n < 3 || n > 14) return false;

  const real = tiles.filter((t) => !isJoker(t));
  if (real.length === 0) return true;

  const v0 = real[0].value;
  const colors = new Set(real.map((t) => t.color));
  const setOK = real.every((t) => t.value === v0) && colors.size === real.length && n <= 4;

  const runColorOK = colors.size === 1;
  const vals = real.map((t) => t.value).sort((a, b) => a - b);
  const uniqOK = new Set(vals).size === vals.length;
  const lo = vals[0];
  const hi = vals[vals.length - 1];
  const fitWindow = Math.max(1, hi - n + 1) <= Math.min(lo, 13 - n + 1);
  const runOK = runColorOK && uniqOK && fitWindow;

  return setOK || runOK;
}

// Упорядочить фишки внутри группы для наглядности:
// серии — по возрастанию чисел (джокеры вставляются в разрывы),
// сеты — по цветам (джокеры в конец).
export function sortMeld(tiles) {
  const arr = tiles.slice();
  const jokers = arr.filter((t) => isJoker(t));
  const real = arr.filter((t) => !isJoker(t));
  if (real.length === 0) return arr;

  if (real.every((t) => t.value === real[0].value)) {
    return [...real.slice().sort((a, b) => a.color.localeCompare(b.color)), ...jokers];
  }

  const sorted = real.slice().sort((a, b) => a.value - b.value);
  const out = [];
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i].value - sorted[i - 1].value - 1;
      for (let k = 0; k < gap && j < jokers.length; k++) out.push(jokers[j++]);
    }
    out.push(sorted[i]);
  }
  while (j < jokers.length) out.push(jokers[j++]);
  return out;
}