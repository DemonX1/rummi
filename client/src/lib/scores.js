// Личная статистика игрока, хранится в localStorage (переживает обновление страницы).
const SCORES_KEY = 'rummi-scores';
const APPLIED_KEY = 'rummi-applied-games';

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return key === APPLIED_KEY ? [] : {};
  }
}

export function loadScores() {
  return read(SCORES_KEY);
}

export function getScore(playerId) {
  const s = loadScores();
  return s[playerId] || 0;
}

// Добавить итоги завершённой партии (players: [{id, score}]) к накопленным очкам
export function addGameScores(players) {
  const s = loadScores();
  for (const p of players) {
    if (p.score) s[p.id] = (s[p.id] || 0) + p.score;
  }
  localStorage.setItem(SCORES_KEY, JSON.stringify(s));
}

// Защита от повторного начисления очков за одну и ту же партию
// (например, при обновлении страницы или повторном получении снимка).
export function wasApplied(gameId) {
  const a = read(APPLIED_KEY);
  return Array.isArray(a) && a.includes(String(gameId));
}

export function markApplied(gameId) {
  const a = read(APPLIED_KEY);
  if (!Array.isArray(a) || a.includes(String(gameId))) return;
  a.push(String(gameId));
  localStorage.setItem(APPLIED_KEY, JSON.stringify(a.slice(-100)));
}