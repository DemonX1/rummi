import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Постоянное хранилище профилей игроков. Модуль игровой-агностичный: профиль
// содержит личность (ник, аватарка) и неймспейсы статистики по играм
// (stats.<gameKey>). Румикуб пишет в stats.rummikub, другие проекты могут
// заводить свои ключи, не зная о чужих.
//
// Файл — server/data/players.json (путь переопределяется через PLAYERS_FILE),
// формат v2:
//   {
//     "version": 2,
//     "profiles": {
//       "<profileId>": {
//         "name", "color", "emoji", "createdAt",
//         "devices": ["<deviceId>", ...],   // устройства, привязанные к профилю
//         "friends": ["<profileId>", ...],  // односторонние закладки для инвайтов
//         "stats": {
//           "rummikub": {
//             "total", "games", "wins", "bestWin",
//             "byPlayers": { "2": {"games","wins"}, ... },
//             "history": [{ "at", "score", "place", "players" }]  // последние 20
//           }
//         }
//       }
//     }
//   }
//
// Идентичность: клиент хранит deviceId в localStorage (rummi-player-id), один на
// устройство. deviceIndex отображает устройство на канонический профиль, поэтому
// один человек с разных устройств играет под одним профилем. Привязка нового
// устройства — через короткоживущий код (createLinkCode/linkDevice).
//
// Миграция v1→v2 выполняется автоматически при загрузке: плоские записи
// {name,color,emoji,total,games,aliases[]} становятся профилями; aliases → devices,
// total/games → stats.rummikub. Старый файл сохраняется как players.json.bak.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(__dirname, '..', 'data', 'players.json');
const FILE = process.env.PLAYERS_FILE || DEFAULT_FILE;

export const GAME_RUMMIKUB = 'rummikub';

// Кастомизация профиля: цвет и смайлик-аватарка (звери).
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

export function sanitizeDeviceId(id) {
  const s = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return s || `u${Math.random().toString(36).slice(2, 10)}`;
}

const HISTORY_LIMIT = 20;

// profileId -> { name, color, emoji, createdAt, devices[], friends[], stats{} }
const profiles = new Map();
// deviceId -> profileId
const deviceIndex = new Map();
// Внутрипроцессные редиректы старых profileId после слияния профилей:
// пока живы комнаты, ссылающиеся на старый id, статистика должна попадать в целевой профиль.
const redirects = new Map();
// Устройства после явной отвязки: резолвятся сами в себя, минуя индекс и редиректы.
const detached = new Set();

function emptyStats() {
  return { total: 0, games: 0, wins: 0, bestWin: 0, byPlayers: {}, history: [] };
}

function normalizeProfile(rec) {
  const stats = {};
  for (const [gameKey, s] of Object.entries(rec.stats || {})) {
    if (!s || typeof s !== 'object') continue;
    stats[gameKey] = {
      total: Number(s.total) || 0,
      games: Number(s.games) || 0,
      wins: Number(s.wins) || 0,
      bestWin: Number(s.bestWin) || 0,
      byPlayers: s.byPlayers && typeof s.byPlayers === 'object' ? s.byPlayers : {},
      history: Array.isArray(s.history)
        ? s.history.slice(-HISTORY_LIMIT).map((h) => ({
            at: Number(h.at) || 0,
            score: Number(h.score) || 0,
            place: Number(h.place) || 0,
            players: Number(h.players) || 0,
          }))
        : [],
    };
  }
  return {
    name: String(rec.name || 'Игрок').slice(0, 20),
    color: sanitizeColor(rec.color),
    emoji: sanitizeEmoji(rec.emoji),
    createdAt: Number(rec.createdAt) || Date.now(),
    devices: Array.isArray(rec.devices) ? rec.devices.map(String) : [],
    friends: Array.isArray(rec.friends) ? rec.friends.map(String) : [],
    stats,
  };
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const obj = { version: 2, profiles: {} };
    for (const [id, rec] of profiles) obj.profiles[id] = rec;
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('Не удалось сохранить профили:', err.message);
  }
}

// Если pid — redirect после слияния, возвращаем актуальный профиль.
function resolveId(pid) {
  let cur = String(pid);
  for (let i = 0; i < 10 && redirects.has(cur); i++) cur = redirects.get(cur);
  return cur;
}

// Устройство -> канонический профиль (или само устройство, если не привязано).
export function resolveDevice(deviceId) {
  const dev = String(deviceId);
  if (detached.has(dev)) return dev;
  return resolveId(deviceIndex.get(dev) ?? dev);
}

export function loadProfiles() {
  profiles.clear();
  deviceIndex.clear();
  redirects.clear();
  detached.clear();
  try {
    if (!fs.existsSync(FILE)) return;
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);

    if (data && Number(data.version) === 2) {
      for (const [id, rec] of Object.entries(data.profiles || {})) {
        profiles.set(String(id), normalizeProfile(rec));
        for (const d of rec.devices || []) deviceIndex.set(String(d), String(id));
      }
      console.log(`Profiles loaded: ${profiles.size} (${FILE})`);
      return;
    }

    migrateV1(data, raw);
  } catch (err) {
    console.error('Не удалось загрузить профили:', err.message);
  }
}

// v1: плоская карта deviceId -> { name, color, emoji, total, games, aliases[] }.
function migrateV1(data, rawBytes) {
  const aliasToCanonical = new Map();
  for (const [id, rec] of Object.entries(data)) {
    if (rec && Array.isArray(rec.aliases)) {
      for (const a of rec.aliases) aliasToCanonical.set(String(a), String(id));
    }
  }

  for (const [id, rec] of Object.entries(data)) {
    const pid = String(id);
    if (aliasToCanonical.has(pid)) continue; // чужой алиас — отдельный профиль не нужен
    if (!rec || typeof rec !== 'object') continue;
    profiles.set(pid, normalizeProfile({
      name: rec.name,
      color: rec.color,
      emoji: rec.emoji,
      createdAt: Date.now(),
      devices: [pid],
      stats: {
        [GAME_RUMMIKUB]: {
          total: Number(rec.total) || 0,
          games: Number(rec.games) || 0,
          wins: 0,
          bestWin: 0,
          byPlayers: {},
          history: [],
        },
      },
    }));
  }

  // Очки записей-алиасов поглощаем каноническим профилем, чтобы ничего не потерять.
  for (const [aliasId, canonicalId] of aliasToCanonical) {
    if (aliasId === canonicalId) continue;
    const leftover = data[aliasId];
    const canon = profiles.get(canonicalId);
    if (leftover && canon) {
      const s = canon.stats[GAME_RUMMIKUB];
      s.total += Number(leftover.total) || 0;
      s.games += Number(leftover.games) || 0;
      if ((!canon.name || canon.name === 'Игрок') && leftover.name) {
        canon.name = String(leftover.name).slice(0, 20);
      }
    }
    // алиас становится устройством канонического профиля
    if (canon && !canon.devices.includes(aliasId)) canon.devices.push(aliasId);
  }

  for (const [id, rec] of profiles) {
    for (const d of rec.devices) deviceIndex.set(d, id);
  }

  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.bak`, rawBytes);
  } catch (err) {
    console.error('Не удалось создать бэкап players.json.bak:', err.message);
  }
  save();
  console.log(`Profiles migrated v1->v2: ${profiles.size} records (${FILE}), backup: ${FILE}.bak`);
}

function viewOf(pid, rec) {
  return { id: pid, name: rec.name, color: rec.color, emoji: rec.emoji };
}

// Вход игрока: устройство резолвится в профиль (создаётся при первом входе).
// touched = игрок менял аватарку в этой сессии — тогда принимаем его выбор.
export function loginPlayer(deviceId, { name, color, emoji, touched } = {}) {
  const dev = String(deviceId);
  const pid = resolveDevice(dev);
  let rec = profiles.get(pid);
  if (!rec) {
    rec = normalizeProfile({
      name: String(name || 'Игрок').slice(0, 20),
      color,
      emoji,
      createdAt: Date.now(),
      devices: [dev],
    });
    profiles.set(pid, rec);
    deviceIndex.set(dev, pid);
    save();
    return viewOf(pid, rec);
  }
  if (!rec.devices.includes(dev)) {
    rec.devices.push(dev);
    deviceIndex.set(dev, pid);
  }
  if (touched) {
    rec.color = sanitizeColor(color);
    rec.emoji = sanitizeEmoji(emoji);
  }
  rec.name = String(name || rec.name).slice(0, 20);
  save();
  return viewOf(pid, rec);
}

// Записать результат партии в неймспейс игры. Вызывается ровно один раз за партию.
export function recordResult(gameKey, pid, { score = 0, won = false, place = 0, players = 0 } = {}) {
  const rec = profiles.get(resolveId(pid));
  if (!rec) return null;
  const s = rec.stats[gameKey] || (rec.stats[gameKey] = emptyStats());
  s.total += score;
  s.games += 1;
  if (won) {
    s.wins += 1;
    if (score > s.bestWin) s.bestWin = score;
  }
  if (players >= 2) {
    const key = String(players);
    const b = s.byPlayers[key] || (s.byPlayers[key] = { games: 0, wins: 0 });
    b.games += 1;
    if (won) b.wins += 1;
  }
  s.history.push({ at: Date.now(), score, place, players });
  if (s.history.length > HISTORY_LIMIT) s.history.splice(0, s.history.length - HISTORY_LIMIT);
  save();
  return s;
}

// Статистика игры по профилю (или устройству — резолвится автоматически).
export function getStats(id, gameKey) {
  const rec = profiles.get(resolveId(id));
  if (!rec) return emptyStats();
  return rec.stats[gameKey] || emptyStats();
}

export function leaderboard(gameKey, limit = 50) {
  const rows = [];
  for (const [id, rec] of profiles) {
    const s = rec.stats[gameKey];
    if (!s || !s.total) continue;
    rows.push({ id, name: rec.name, color: rec.color, emoji: rec.emoji, score: s.total, games: s.games, wins: s.wins });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

// --- Коды привязки устройств ---

const LINK_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// code -> { profileId, expiresAt }; живут только в памяти, переживать рестарт не нужно.
const linkCodes = new Map();

export function createLinkCode(profileId, now = Date.now()) {
  const pid = resolveId(profileId);
  if (!profiles.has(pid)) return null;
  for (const [code, info] of linkCodes) {
    if (info.profileId === pid || info.expiresAt <= now) linkCodes.delete(code);
  }
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (linkCodes.has(code));
  const expiresAt = now + LINK_TTL_MS;
  linkCodes.set(code, { profileId: pid, expiresAt });
  return { code, expiresAt };
}

export function consumeLinkCode(code, now = Date.now()) {
  const c = String(code || '').trim().toUpperCase();
  const info = linkCodes.get(c);
  if (!info) return null;
  linkCodes.delete(c);
  if (info.expiresAt <= now) return null;
  return info.profileId;
}

function mergeStatsInto(targetRec, sourceRec) {
  for (const [gameKey, src] of Object.entries(sourceRec.stats || {})) {
    const dst = targetRec.stats[gameKey] || (targetRec.stats[gameKey] = emptyStats());
    dst.total += src.total || 0;
    dst.games += src.games || 0;
    dst.wins += src.wins || 0;
    dst.bestWin = Math.max(dst.bestWin || 0, src.bestWin || 0);
    for (const [k, b] of Object.entries(src.byPlayers || {})) {
      const acc = dst.byPlayers[k] || (dst.byPlayers[k] = { games: 0, wins: 0 });
      acc.games += b.games || 0;
      acc.wins += b.wins || 0;
    }
    dst.history = [...dst.history, ...(src.history || [])]
      .sort((a, b) => a.at - b.at)
      .slice(-HISTORY_LIMIT);
  }
}

// Привязать устройство к профилю по коду. Если у устройства уже был свой профиль
// со статистикой — она поглощается целевым профилем (как раньше делали aliases),
// а старый pid остаётся внутрипроцессным редиректом для живых комнат.
export function linkDevice(deviceId, code, { now = Date.now() } = {}) {
  const dev = String(deviceId);
  const targetPid = consumeLinkCode(code, now);
  if (!targetPid) return { error: 'Код не найден или истёк' };
  const target = profiles.get(targetPid);
  if (!target) return { error: 'Профиль не найден' };

  const currentPid = deviceIndex.get(dev);
  if (currentPid === targetPid) {
    return { error: 'Это устройство уже привязано к данному профилю', profile: profileView(targetPid) };
  }

  // Собственный профиль устройства (обычно создан первым входом) поглощаем.
  const ownPid = currentPid ?? dev;
  const own = profiles.get(ownPid);
  if (own && ownPid !== targetPid) {
    mergeStatsInto(target, own);
    target.friends = [...new Set([...target.friends, ...own.friends])].filter((f) => f !== targetPid && f !== ownPid);
    for (const otherDev of own.devices) {
      if (otherDev === dev) continue;
      deviceIndex.set(otherDev, targetPid);
      if (!target.devices.includes(otherDev)) target.devices.push(otherDev);
    }
    profiles.delete(ownPid);
    redirects.set(ownPid, targetPid);
  }

  if (!target.devices.includes(dev)) target.devices.push(dev);
  deviceIndex.set(dev, targetPid);
  detached.delete(dev);
  save();
  return { ok: true, profile: profileView(targetPid) };
}

// Отвязать устройство от профиля. Последнее устройство отвязать нельзя.
// Отвязанное устройство при следующем входе начнёт новый пустой профиль.
export function unlinkDevice(deviceId) {
  const dev = String(deviceId);
  const pid = deviceIndex.get(dev);
  if (!pid) return { error: 'Устройство не привязано к профилю' };
  const rec = profiles.get(pid);
  if (!rec) return { error: 'Профиль не найден' };
  if ((rec.devices?.length || 0) <= 1) {
    return { error: 'Нельзя отвязать последнее устройство профиля' };
  }
  rec.devices = rec.devices.filter((d) => d !== dev);
  deviceIndex.delete(dev);
  // После отвязки устройство не должно «просачиваться» обратно через редиректы
  // слияний — оно начинает с чистого листа.
  detached.add(dev);
  save();
  return { ok: true };
}

// --- Друзья (односторонние закладки для приглашений) ---

export function friendsAdd(pid, friendPid) {
  const me = resolveId(pid);
  const friend = resolveId(friendPid);
  if (friend === me) return { error: 'Нельзя добавить в друзья себя' };
  if (!profiles.get(me)) return { error: 'Профиль не найден' };
  if (!profiles.get(friend)) return { error: 'Профиль игрока не найден' };
  const rec = profiles.get(me);
  if (!rec.friends.includes(friend)) {
    rec.friends.push(friend);
    save();
  }
  return { ok: true };
}

export function friendsRemove(pid, friendPid) {
  const me = resolveId(pid);
  const rec = profiles.get(me);
  if (!rec) return { error: 'Профиль не найден' };
  const before = rec.friends.length;
  rec.friends = rec.friends.filter((f) => f !== resolveId(friendPid));
  if (rec.friends.length !== before) save();
  return { ok: true };
}

// Сырые записи друзей (без online-флага — он знает только сокет-слой).
export function friendsRecords(pid) {
  const rec = profiles.get(resolveId(pid));
  if (!rec) return [];
  return rec.friends
    .map((fid) => {
      const fr = profiles.get(fid);
      return fr ? { id: fid, name: fr.name, color: fr.color, emoji: fr.emoji } : null;
    })
    .filter(Boolean);
}

// Полный взгляд на свой профиль (для модала «Мой профиль»).
export function profileView(id) {
  const pid = resolveId(id);
  const rec = profiles.get(pid);
  if (!rec) return null;
  return {
    id: pid,
    name: rec.name,
    color: rec.color,
    emoji: rec.emoji,
    createdAt: rec.createdAt,
    devices: [...rec.devices],
    friends: [...rec.friends],
    stats: JSON.parse(JSON.stringify(rec.stats)),
  };
}
