import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Game } from './game/game.js';
import { aiDecision } from './game/ai.js';
import {
  PLAYER_COLORS,
  PLAYER_EMOJIS,
  DEFAULT_COLOR,
  DEFAULT_EMOJI,
  GAME_RUMMIKUB,
  sanitizeDeviceId,
  loadProfiles,
  loginPlayer,
  recordResult,
  getStats,
  leaderboard,
  createLinkCode,
  linkDevice,
  unlinkDevice,
  friendsAdd,
  friendsRemove,
  friendsRecords,
  profileView,
  resolveDevice,
} from './profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', '..', 'client', 'dist');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

loadProfiles();

if (isProd) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// --- Хранилище комнат ---
const rooms = new Map(); // code -> room
const socketRooms = new Map(); // socketId -> code
const timers = new Map(); // code -> timeout (ходы ботов)
// Ключ `${room.code}:${playerId}` — один профиль может сидеть в двух комнатах
// с разных устройств, глобальный ключ по playerId затирал бы чужие таймеры.
const disconnectTimers = new Map(); // seatKey -> timeout (grace на переподключение)

// Реестр присутствия: какие сокеты принадлежат какому профилю (для инвайтов
// и online-статуса друзей). Профиль онлайн, если жив хотя бы один его сокет.
const presence = new Map(); // profileId -> Set<socketId>
const socketProfile = new Map(); // socketId -> profileId

const MAX_PLAYERS = 4;
const RECONNECT_GRACE_MS = 8000; // столько ждём игрока после обрыва, прежде чем включить автопилот

// Коэффициент очков за партию: полный — только «все люди + hard»,
// с ботами и на низких сложностях сильно урезан (защита от фарма).
const SCORE_MULT_HUMANS = { easy: 0.25, medium: 0.5, hard: 1 };
const SCORE_MULT_WITH_BOTS = { easy: 0.1, medium: 0.2, hard: 0.5 };

function scoreMultiplier(room) {
  const humanOnly = room.players.every((p) => !p.ai);
  const table = humanOnly ? SCORE_MULT_HUMANS : SCORE_MULT_WITH_BOTS;
  return table[room.settings.difficulty] ?? 1;
}

function botProfile(room) {
  return {
    color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
    emoji: PLAYER_EMOJIS[(room.players.length + 1) % PLAYER_EMOJIS.length],
  };
}

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function botName(i) {
  return i === 1 ? 'Компьютер' : `Компьютер ${i}`;
}

// ID устройства из клиента — стабильный, переживает обновление страницы.
// Профиль игрока резолвится из устройства в profiles.js (sanitizeDeviceId).
const sanitizeId = sanitizeDeviceId;

function seatKey(room, playerId) {
  return `${room.code}:${playerId}`;
}

// --- Присутствие ---
function bindPresence(socket, profileId) {
  const prev = socketProfile.get(socket.id);
  if (prev && prev !== profileId) {
    const set = presence.get(prev);
    if (set) {
      set.delete(socket.id);
      if (!set.size) presence.delete(prev);
    }
  }
  socketProfile.set(socket.id, profileId);
  let set = presence.get(profileId);
  if (!set) {
    set = new Set();
    presence.set(profileId, set);
  }
  set.add(socket.id);
}

function dropPresence(socketId) {
  const pid = socketProfile.get(socketId);
  socketProfile.delete(socketId);
  if (!pid) return;
  const set = presence.get(pid);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) presence.delete(pid);
}

function isOnline(profileId) {
  const set = presence.get(profileId);
  return !!set && set.size > 0;
}

function getPlayerBySocket(room, socket) {
  return room.players.find((p) => p.socketId === socket.id);
}

function clearPlayerPresence(player) {
  player.socketId = null;
  player.connected = false;
}

function markDisconnected(room, player) {
  clearPlayerPresence(player);
  const gp = room.game && room.game.getPlayer(player.id);
  if (gp) gp.connected = false;

  const key = seatKey(room, player.id);
  const prev = disconnectTimers.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    disconnectTimers.delete(key);
    const r = rooms.get(room.code);
    if (!r) return;
    const p = r.players.find((x) => x.id === player.id);
    if (!p || p.connected) return; // успел переподключиться
    if (r.status === 'lobby') {
      r.players = r.players.filter((x) => x.id !== player.id);
      if (r.players.length === 0) {
        clearTimer(r);
        rooms.delete(r.code);
      } else {
        if (r.hostId === player.id) r.hostId = r.players[0].id;
        broadcastRoom(r);
      }
    } else {
      if (r.players.filter((x) => x.connected).length === 0) {
        clearTimer(r);
        rooms.delete(r.code);
      } else {
        broadcastRoom(r);
        scheduleAi(r); // за отключённого теперь играет автопилот
      }
    }
  }, RECONNECT_GRACE_MS);
  disconnectTimers.set(key, t);
}

function rejoinPlayer(room, player, socket) {
  player.socketId = socket.id;
  player.connected = true;
  const gp = room.game && room.game.getPlayer(player.id);
  if (gp) gp.connected = true;
  const key = seatKey(room, player.id);
  const prev = disconnectTimers.get(key);
  if (prev) {
    clearTimeout(prev);
    disconnectTimers.delete(key);
  }
}

function snapshot(room, playerId) {
  const g = room.game;
  const base = {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: { ...room.settings },
    players: room.players.map((p) => {
      const s = p.ai ? null : getStats(p.id, GAME_RUMMIKUB);
      return {
        id: p.id,
        name: p.name,
        ai: !!p.ai,
        color: p.color || DEFAULT_COLOR,
        emoji: p.emoji || DEFAULT_EMOJI,
        connected: !!p.connected,
        total: s ? s.total : 0,
        games: s ? s.games : 0,
      };
    }),
    game: null,
  };
  if (g) {
    const me = g.getPlayer(playerId);
    const cur = g.currentPlayer();
    base.game = {
      gameId: room.gameSeq,
      phase: g.phase,
      winnerId: g.winner ? g.winner.id : null,
      turnIndex: g.turnIndex,
      board: g.board,
      stockCount: g.stock.length,
      log: g.log.slice(-10),
      difficulty: g.difficulty,
      multiplier: g.scoreMultiplier ?? 1,
      played: g.played
        ? [...g.played].map(([pid, tileIds]) => {
            const p = g.getPlayer(pid);
            if (!p || !tileIds.length) return null;
            return {
              id: pid,
              name: p.name,
              color: p.color || DEFAULT_COLOR,
              emoji: p.emoji || DEFAULT_EMOJI,
              tileIds,
            };
          }).filter(Boolean)
        : [],
      players: g.players.map((p) => {
        const s = p.ai ? null : getStats(p.id, GAME_RUMMIKUB);
        return {
          id: p.id,
          name: p.name,
          ai: !!p.ai,
          color: p.color || DEFAULT_COLOR,
          emoji: p.emoji || DEFAULT_EMOJI,
          handCount: p.hand.length,
          melded: p.melded,
          score: p.score || 0,
          think: p.think || 0,
          total: s ? s.total : 0,
          games: s ? s.games : 0,
        };
      }),
      you: me
        ? { hand: me.hand, melded: me.melded, drew: g.turnDrew, yourTurn: cur.id === me.id }
        : null,
    };
  }
  return base;
}

function emitRoom(room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('room', snapshot(room, p.id));
  }
}

// Начислить итоги завершённой партии в профиль каждого игрока ровно один раз
// за игру (см. profiles.js, stats.rummikub). Ничья и досрочное завершение
// (без победителя) в статистику не попадают.
function settleGame(room) {
  const g = room.game;
  if (!g || g.phase !== 'ended') return;
  if (room.settledSeq === room.gameSeq) return;
  room.settledSeq = room.gameSeq;
  if (!g.winner) return;
  const standings = [...g.players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const placeOf = new Map(standings.map((p, i) => [p.id, i + 1]));
  for (const p of g.players) {
    if (p.ai) continue; // боты в статистику и таблицу лидеров не попадают
    recordResult(GAME_RUMMIKUB, p.id, {
      score: p.score || 0,
      won: g.winner.id === p.id,
      place: placeOf.get(p.id),
      players: g.players.length,
    });
  }
}

function clearTimer(room) {
  const t = timers.get(room.code);
  if (t) {
    clearTimeout(t);
    timers.delete(room.code);
  }
}

function scheduleAi(room) {
  clearTimer(room);
  const g = room.game;
  if (!g || g.phase !== 'playing') return;
  const cur = g.players[g.turnIndex];
  if (!cur.ai && cur.connected) return;

  const delay = 700 + Math.random() * 900;
  const t = setTimeout(() => {
    timers.delete(room.code);
    if (rooms.get(room.code) !== room || !room.game || room.game !== g) return;
    if (g.phase !== 'playing') return;
    if (g.players[g.turnIndex].id !== cur.id) return;

    const decision = aiDecision(g);
    let applied = false;
    if (decision) {
      // Бот ходит через ту же валидацию game.play(), что и живой игрок
      applied = g.play(cur.id, decision.board).ok;
    }
    if (!applied) g.draw(cur.id);
    emitRoom(room);
    scheduleAi(room);
  }, delay);
  timers.set(room.code, t);
}

function addBotToRoom(room, socket) {
  if (room.players.length >= MAX_PLAYERS) {
    socket.emit('error', 'Комната заполнена');
    return;
  }
  const botCount = room.players.filter((p) => p.ai).length;
  room.players.push({
    id: `bot-${Math.random().toString(36).slice(2, 10)}`,
    name: botName(botCount + 1),
    ai: true,
    socketId: null,
    connected: true,
    ...botProfile(room),
  });
}

function broadcastRoom(room) {
  settleGame(room);
  emitRoom(room);
}

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.on('room:create', ({ id, name, addBot, difficulty, color, emoji, touched } = {}, cb) => {
    const code = randCode();
    // Устройство резолвится в профиль: комнаты и статистика ключуются на профиль,
    // чтобы человек с разных устройств был одним игроком.
    const rec = loginPlayer(sanitizeId(id), { name, color, emoji, touched });
    const pid = rec.id;
    bindPresence(socket, pid);
    const player = {
      id: pid,
      socketId: socket.id,
      name: rec.name,
      ai: false,
      color: rec.color,
      emoji: rec.emoji,
      connected: true,
    };
    const room = {
      code,
      hostId: pid,
      status: 'lobby',
      settings: { difficulty: difficulty || 'medium' },
      players: [player],
      game: null,
      gameSeq: 0,
    };
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    socket.join(code);
    if (addBot) addBotToRoom(room, socket);
    cb?.({ ok: true, snapshot: snapshot(room, pid), profileId: pid });
    broadcastRoom(room);
  });

  socket.on('room:join', ({ code, name, id, color, emoji, touched } = {}, cb) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Игра уже началась' });
    const rec = loginPlayer(sanitizeId(id), { name, color, emoji, touched });
    const pid = rec.id;
    bindPresence(socket, pid);

    const existing = room.players.find((p) => p.id === pid && !p.ai);
    if (existing) {
      // Игрок с таким же профилем уже в комнате (например, зашёл с другого
      // устройства или обновил страницу) — просто переподключаем
      existing.name = rec.name;
      existing.color = rec.color;
      existing.emoji = rec.emoji;
      rejoinPlayer(room, existing, socket);
      socketRooms.set(socket.id, room.code);
      socket.join(room.code);
      cb?.({ ok: true, snapshot: snapshot(room, existing.id), profileId: existing.id });
      broadcastRoom(room);
      return;
    }

    if (room.players.length >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Комната заполнена' });

    const player = {
      id: pid,
      socketId: socket.id,
      name: rec.name,
      ai: false,
      color: rec.color,
      emoji: rec.emoji,
      connected: true,
    };
    room.players.push(player);
    socketRooms.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true, snapshot: snapshot(room, pid), profileId: pid });
    broadcastRoom(room);
  });

  // Восстановление сессии после обновления страницы
  socket.on('room:rejoin', ({ code, id, name, color, emoji, touched } = {}, cb) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });
    const rec = loginPlayer(sanitizeId(id), { name, color, emoji, touched });
    const pid = rec.id;
    bindPresence(socket, pid);
    const player = room.players.find((p) => p.id === pid && !p.ai);
    if (!player) return cb?.({ ok: false, error: 'Сессия не найдена' });
    player.name = rec.name;
    player.color = rec.color;
    player.emoji = rec.emoji;
    rejoinPlayer(room, player, socket);
    socketRooms.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true, snapshot: snapshot(room, player.id), profileId: player.id });
    broadcastRoom(room);
    scheduleAi(room);
  });

  socket.on('room:addBot', (cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && getPlayerBySocket(room, socket);
    if (!room || !me) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.hostId !== me.id) return cb?.({ ok: false, error: 'Только хост может добавлять ботов' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Игра уже началась' });
    addBotToRoom(room, socket);
    cb?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('room:removeBot', (botId, cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && getPlayerBySocket(room, socket);
    if (!room || !me) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.hostId !== me.id) return cb?.({ ok: false, error: 'Только хост может удалять ботов' });
    room.players = room.players.filter((p) => !(p.id === botId && p.ai));
    cb?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('room:setDifficulty', (difficulty, cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && getPlayerBySocket(room, socket);
    if (!room || !me) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.hostId !== me.id) return cb?.({ ok: false, error: 'Только хост' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Сложность можно менять только в лобби' });
    if (['easy', 'medium', 'hard'].includes(difficulty)) {
      room.settings.difficulty = difficulty;
    }
    cb?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('room:start', (cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && getPlayerBySocket(room, socket);
    if (!room || !me) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.hostId !== me.id) return cb?.({ ok: false, error: 'Только хост может начать игру' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Игра уже идёт' });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'Нужно минимум 2 игрока (можно добавить бота)' });

    room.gameSeq += 1;
    const mult = scoreMultiplier(room);
    room.game = new Game(
      room.players.map((p) => ({ id: p.id, name: p.name, ai: p.ai, color: p.color, emoji: p.emoji })),
      room.settings.difficulty,
      mult
    );
    room.status = 'playing';
    cb?.({ ok: true });
    broadcastRoom(room);
    scheduleAi(room);
  });

  socket.on('game:play', (payload, cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && room.game && getPlayerBySocket(room, socket);
    if (!room || !me || !room.game) return cb?.({ ok: false, error: 'Игра не найдена' });
    const res = room.game.play(me.id, payload?.board);
    cb?.(res);
    if (res.ok) {
      broadcastRoom(room);
      scheduleAi(room);
    }
  });

  socket.on('game:draw', (cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && room.game && getPlayerBySocket(room, socket);
    if (!room || !me || !room.game) return cb?.({ ok: false, error: 'Игра не найдена' });
    const res = room.game.draw(me.id);
    cb?.(res);
    if (res.ok) {
      broadcastRoom(room);
      scheduleAi(room);
    }
  });

  // Досрочное завершение игры (хост)
  socket.on('game:end', (cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && room.game && getPlayerBySocket(room, socket);
    if (!room || !me || !room.game) return cb?.({ ok: false, error: 'Игра не найдена' });
    if (room.game.phase !== 'playing') return cb?.({ ok: false, error: 'Игра уже окончена' });
    if (room.hostId !== me.id) return cb?.({ ok: false, error: 'Только хост может завершить игру досрочно' });
    clearTimer(room);
    room.game.endEarly();
    cb?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('leaderboard:get', (cb) => {
    cb?.({ ok: true, leaderboard: leaderboard(GAME_RUMMIKUB, 50) });
  });

  // --- Профили ---

  // Полный взгляд на свой профиль (статистика, устройства, друзья).
  // Заодно гарантируем существование профиля устройства.
  socket.on('profile:get', ({ id, name, color, emoji, touched } = {}, cb) => {
    const rec = loginPlayer(sanitizeId(id), { name, color, emoji, touched });
    bindPresence(socket, rec.id);
    cb?.({ ok: true, profile: profileView(rec.id), profileId: rec.id });
  });

  // Код привязки: введите его на другом устройстве, чтобы играть под этим профилем.
  socket.on('profile:code:create', ({ id } = {}, cb) => {
    const rec = loginPlayer(sanitizeId(id), {});
    const info = createLinkCode(rec.id);
    if (!info) return cb?.({ ok: false, error: 'Не удалось создать код' });
    cb?.({ ok: true, ...info });
  });

  // Привязать это устройство к чужому профилю по коду.
  socket.on('profile:link', ({ id, code } = {}, cb) => {
    const deviceId = sanitizeId(id);
    const res = linkDevice(deviceId, code);
    if (res.error) return cb?.({ ok: false, error: res.error });
    bindPresence(socket, res.profile.id);
    cb?.({ ok: true, profile: res.profile, profileId: res.profile.id });
  });

  // Отвязать устройство от профиля.
  socket.on('profile:unlink', ({ id, deviceId } = {}, cb) => {
    const pid = resolveDevice(sanitizeId(id));
    const res = unlinkDevice(String(deviceId || ''));
    if (res.error) return cb?.(res);
    cb?.({ ok: true, profile: profileView(pid) });
  });

  socket.on('profile:friends:add', ({ id, friendId } = {}, cb) => {
    const rec = loginPlayer(sanitizeId(id), {});
    const res = friendsAdd(rec.id, String(friendId || ''));
    if (res.error) return cb?.(res);
    cb?.({ ok: true, profile: profileView(rec.id) });
  });

  socket.on('profile:friends:remove', ({ id, friendId } = {}, cb) => {
    const pid = resolveDevice(sanitizeId(id));
    const res = friendsRemove(pid, String(friendId || ''));
    if (res.error) return cb?.(res);
    cb?.({ ok: true, profile: profileView(pid) });
  });

  socket.on('profile:friends:list', ({ id } = {}, cb) => {
    const pid = resolveDevice(sanitizeId(id));
    bindPresence(socket, pid);
    cb?.({
      ok: true,
      friends: friendsRecords(pid).map((f) => ({ ...f, online: isOnline(f.id), me: f.id === pid })),
    });
  });

  // Пригласить друга в свою комнату (только хост, только лобби).
  socket.on('room:invite', ({ toPid } = {}, cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    const me = room && getPlayerBySocket(room, socket);
    if (!room || !me) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.hostId !== me.id) return cb?.({ ok: false, error: 'Только хост может приглашать' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Приглашать можно только в лобби' });
    const targetPid = resolveDevice(String(toPid || ''));
    if (targetPid === me.id) return cb?.({ ok: false, error: 'Вы уже в этой комнате' });
    const sockets = presence.get(targetPid);
    if (!sockets || !sockets.size) return cb?.({ ok: false, error: 'Игрок не в сети' });
    const from = { name: me.name, color: me.color, emoji: me.emoji };
    for (const sid of sockets) io.sockets.sockets.get(sid)?.emit('invite', { from, code: room.code });
    cb?.({ ok: true });
  });

  socket.on('room:leave', (cb) => {
    const room = rooms.get(socketRooms.get(socket.id));
    if (!room) return cb?.({ ok: true });
    const player = getPlayerBySocket(room, socket);
    if (room.status === 'lobby' && player) {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (room.players.length === 0) {
        clearTimer(room);
        rooms.delete(room.code);
        socketRooms.delete(socket.id);
        socket.leave(room.code);
        return cb?.({ ok: true });
      }
      if (room.hostId === player.id) room.hostId = room.players[0].id;
      socketRooms.delete(socket.id);
      socket.leave(room.code);
      broadcastRoom(room);
      return cb?.({ ok: true });
    }
    // Во время игры явный выход: сразу автопилот, без grace-периода
    if (player) {
      clearPlayerPresence(player);
      const gp = room.game && room.game.getPlayer(player.id);
      if (gp) gp.connected = false;
      const key = seatKey(room, player.id);
      const prev = disconnectTimers.get(key);
      if (prev) {
        clearTimeout(prev);
        disconnectTimers.delete(key);
      }
      if (room.players.filter((p) => p.connected).length === 0) {
        clearTimer(room);
        rooms.delete(room.code);
      } else {
        broadcastRoom(room);
        scheduleAi(room);
      }
    }
    socketRooms.delete(socket.id);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    dropPresence(socket.id);
    const code = socketRooms.get(socket.id);
    socketRooms.delete(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = getPlayerBySocket(room, socket);
    if (!player || player.socketId !== socket.id) return; // сокет уже вытеснен переподключением

    // Обрыв соединения: ждём переподключение (grace), затем автопилот/удаление
    markDisconnected(room, player);
    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Rummikub server listening on http://localhost:${PORT} (${isProd ? 'production' : 'dev'})`);
});
