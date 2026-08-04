import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Game } from './game/game.js';
import { aiDecision } from './game/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', '..', 'client', 'dist');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

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
const disconnectTimers = new Map(); // playerId -> timeout (grace на переподключение)

// Накопленные очки игроков (сервер — единственный источник правды: начисляются
// один раз при завершении партии, refresh не приводит к повторному начислению).
const cumulativeScores = new Map(); // playerId -> суммарные очки

const MAX_PLAYERS = 4;
const RECONNECT_GRACE_MS = 8000; // столько ждём игрока после обрыва, прежде чем включить автопилот

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

// ID игрока из клиента — стабильный, переживает обновление страницы
function sanitizeId(id) {
  const s = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return s || `u${Math.random().toString(36).slice(2, 10)}`;
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

  const prev = disconnectTimers.get(player.id);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    disconnectTimers.delete(player.id);
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
  disconnectTimers.set(player.id, t);
}

function rejoinPlayer(room, player, socket) {
  player.socketId = socket.id;
  player.connected = true;
  const gp = room.game && room.game.getPlayer(player.id);
  if (gp) gp.connected = true;
  const prev = disconnectTimers.get(player.id);
  if (prev) {
    clearTimeout(prev);
    disconnectTimers.delete(player.id);
  }
}

function snapshot(room, playerId) {
  const g = room.game;
  const base = {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: { ...room.settings },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ai: !!p.ai,
      connected: !!p.connected,
      total: cumulativeScores.get(p.id) || 0,
    })),
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
      players: g.players.map((p) => ({
        id: p.id,
        name: p.name,
        ai: !!p.ai,
        handCount: p.hand.length,
        melded: p.melded,
        score: p.score || 0,
        total: cumulativeScores.get(p.id) || 0,
      })),
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

// Начислить очки завершённой партии в общую копилку ровно один раз за игру.
function settleGame(room) {
  const g = room.game;
  if (!g || g.phase !== 'ended') return;
  if (room.settledSeq === room.gameSeq) return;
  room.settledSeq = room.gameSeq;
  for (const p of g.players) {
    if (p.score) cumulativeScores.set(p.id, (cumulativeScores.get(p.id) || 0) + p.score);
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
    if (decision) {
      cur.hand = decision.hand;
      cur.melded = decision.melded;
      g.board = decision.board;
      g.log.push(`${cur.name} выложил фишки на стол.`);
      if (cur.hand.length === 0) {
        g.winner = cur;
        g.finish();
      } else {
        g.advanceTurn();
        g.log.push(`Ходит ${g.currentPlayer().name}.`);
      }
    } else {
      g.draw(cur.id);
    }
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
  });
}

function broadcastRoom(room) {
  settleGame(room);
  emitRoom(room);
}

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.on('room:create', ({ id, name, addBot, difficulty } = {}, cb) => {
    const code = randCode();
    const pid = sanitizeId(id);
    const player = {
      id: pid,
      socketId: socket.id,
      name: String(name || 'Игрок').slice(0, 20),
      ai: false,
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
    cb?.({ ok: true, snapshot: snapshot(room, pid) });
    broadcastRoom(room);
  });

  socket.on('room:join', ({ code, name, id } = {}, cb) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Игра уже началась' });
    const pid = sanitizeId(id);

    const existing = room.players.find((p) => p.id === pid && !p.ai);
    if (existing) {
      // Игрок с таким же id уже в комнате (например, обновил страницу) — просто переподключаем
      rejoinPlayer(room, existing, socket);
      socketRooms.set(socket.id, room.code);
      socket.join(room.code);
      cb?.({ ok: true, snapshot: snapshot(room, existing.id) });
      broadcastRoom(room);
      return;
    }

    if (room.players.length >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Комната заполнена' });

    const player = {
      id: pid,
      socketId: socket.id,
      name: String(name || 'Игрок').slice(0, 20),
      ai: false,
      connected: true,
    };
    room.players.push(player);
    socketRooms.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true, snapshot: snapshot(room, pid) });
    broadcastRoom(room);
  });

  // Восстановление сессии после обновления страницы
  socket.on('room:rejoin', ({ code, id, name } = {}, cb) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });
    const player = room.players.find((p) => p.id === sanitizeId(id) && !p.ai);
    if (!player) return cb?.({ ok: false, error: 'Сессия не найдена' });

    rejoinPlayer(room, player, socket);
    socketRooms.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true, snapshot: snapshot(room, player.id) });
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
    room.game = new Game(
      room.players.map((p) => ({ id: p.id, name: p.name, ai: p.ai })),
      room.settings.difficulty
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
      const prev = disconnectTimers.get(player.id);
      if (prev) {
        clearTimeout(prev);
        disconnectTimers.delete(player.id);
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
