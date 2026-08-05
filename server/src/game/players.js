import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Постоянное хранилище игроков (таблица лидеров): ник, аватарка и накопленные
// очки живут на сервере в JSON-файле и переживают перезапуск сервера.
// Путь можно переопределить через PLAYERS_FILE (см. Dockerfile/README).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(__dirname, '..', '..', 'data', 'players.json');
const FILE = process.env.PLAYERS_FILE || DEFAULT_FILE;

// Кастомизация профиля игрока: цвет и смайлик-аватарка (звери).
export const PLAYER_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
export const PLAYER_EMOJIS = ['🐶', '🐱', '🦊', '🐻', '🐼', '🦁', '🐸', '🐵', '🦉', '🐺'];
export const DEFAULT_COLOR = PLAYER_COLORS[3];
export const DEFAULT_EMOJI = PLAYER_EMOJIS[0];

export function sanitizeColor(c) {
  return PLAYER_COLORS.includes(c) ? c : DEFAULT_COLOR;
}

export function sanitizeEmoji(e) {
  return PLAYER_EMOJIS.includes(e) ? e : DEFAULT_EMOJI;
}

// playerId -> { name, color, emoji, total }
const store = new Map();

export function loadPlayers() {
  try {
    if (!fs.existsSync(FILE)) return;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [id, rec] of Object.entries(data)) {
      store.set(String(id), {
        name: String(rec.name || 'Игрок'),
        color: sanitizeColor(rec.color),
        emoji: sanitizeEmoji(rec.emoji),
        total: Number(rec.total) || 0,
      });
    }
    console.log(`Players loaded: ${store.size} records (${FILE})`);
  } catch (err) {
    console.error('Не удалось загрузить players.json:', err.message);
  }
}

function savePlayers() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const obj = {};
    for (const [id, rec] of store) obj[id] = rec;
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('Не удалось сохранить players.json:', err.message);
  }
}

export function getPlayer(id) {
  return store.get(String(id));
}

export function getTotal(id) {
  const rec = store.get(String(id));
  return rec ? rec.total : 0;
}

// Вход игрока: если запись есть — возвращаем сохранённый профиль и очки.
// Если клиент менял аватарку в этой сессии (touched) — обновляем запись.
export function loginPlayer(id, { name, color, emoji, touched }) {
  const key = String(id);
  let rec = store.get(key);
  if (!rec) {
    rec = {
      name: String(name || 'Игрок').slice(0, 20),
      color: sanitizeColor(color),
      emoji: sanitizeEmoji(emoji),
      total: 0,
    };
    store.set(key, rec);
    savePlayers();
    return rec;
  }
  if (touched) {
    rec.color = sanitizeColor(color);
    rec.emoji = sanitizeEmoji(emoji);
    savePlayers();
  }
  rec.name = String(name || rec.name).slice(0, 20);
  return rec;
}

// Начисление очков по итогам партии (один раз за gameId — см. settleGame).
export function addScore(id, delta, { name, color, emoji }) {
  const key = String(id);
  let rec = store.get(key);
  if (!rec) {
    rec = {
      name: String(name || 'Игрок').slice(0, 20),
      color: sanitizeColor(color),
      emoji: sanitizeEmoji(emoji),
      total: 0,
    };
    store.set(key, rec);
  }
  rec.total = (rec.total || 0) + delta;
  if (name) rec.name = String(name).slice(0, 20);
  if (color) rec.color = sanitizeColor(color);
  if (emoji) rec.emoji = sanitizeEmoji(emoji);
  savePlayers();
  return rec;
}

export function leaderboard(limit = 50) {
  const rows = [];
  for (const [id, rec] of store) {
    if (!rec.total) continue;
    rows.push({ id, name: rec.name, color: rec.color, emoji: rec.emoji, score: rec.total });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}
