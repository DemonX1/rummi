import React, { useCallback, useEffect, useRef, useState } from 'react';
import Home from './components/Home.jsx';
import Room from './components/Room.jsx';
import Game from './components/Game.jsx';
import {
  socket,
  emit,
  getPlayerId,
  getSession,
  saveSession,
  clearSession,
  getProfile,
} from './lib/socket.js';

export default function App() {
  const [snap, setSnap] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const meId = getPlayerId();

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Восстановление после обновления страницы и после авто-переподключения.
  // Срабатывает только на реальных rejoin-событиях: монтирование + socket connect.
  const tryRejoin = useCallback(() => {
    const sess = getSession();
    if (!sess?.code) return;
    const prof = getProfile();
    emit('room:rejoin', {
      code: sess.code,
      id: meId,
      name: sess.name || 'Игрок',
      color: prof.color,
      emoji: prof.emoji,
    }).then((res) => {
      if (!res?.ok) clearSession();
    });
  }, [meId]);

  useEffect(() => {
    socket.on('room', (s) => {
      setSnap(s);
    });
    socket.on('error', showToast);
    socket.on('connect', tryRejoin);

    tryRejoin();

    return () => {
      socket.off('room', setSnap);
      socket.off('error', showToast);
      socket.off('connect', tryRejoin);
    };
  }, [showToast, tryRejoin]);

  const actions = useMemoActions(showToast, meId);

  const exitToHome = useCallback(async () => {
    await actions.leave();
    clearSession();
    setSnap(null);
  }, [actions]);

  if (snap?.game) {
    return (
      <>
        <Game snap={snap} meId={meId} actions={actions} onExit={exitToHome} />
        <Toast msg={toast} />
      </>
    );
  }

  if (snap?.code) {
    return (
      <>
        <Room snap={snap} meId={meId} actions={actions} onLeave={exitToHome} />
        <Toast msg={toast} />
      </>
    );
  }

  return (
    <>
      <Home meId={meId} actions={actions} />
      <Toast msg={toast} />
    </>
  );
}

function useMemoActions(showToast, meId) {
  return useCallback(
    {
      async create(name, addBot) {
        const prof = getProfile();
        const res = await emit('room:create', { id: meId, name, addBot, color: prof.color, emoji: prof.emoji });
        if (!res?.ok) {
          showToast(res?.error || 'Не удалось создать комнату');
          return;
        }
        saveSession(res.snapshot.code, name.trim());
      },
      async join(code, name) {
        const prof = getProfile();
        const res = await emit('room:join', { code, name, id: meId, color: prof.color, emoji: prof.emoji });
        if (!res?.ok) {
          showToast(res?.error || 'Не удалось присоединиться');
          return;
        }
        saveSession(res.snapshot.code, name.trim());
      },
      async leave() {
        await emit('room:leave');
      },
      async addBot() {
        const res = await emit('room:addBot');
        if (!res?.ok) showToast(res?.error);
      },
      async removeBot(id) {
        const res = await emit('room:removeBot', id);
        if (!res?.ok) showToast(res?.error);
      },
      async setDifficulty(d) {
        const res = await emit('room:setDifficulty', d);
        if (!res?.ok) showToast(res?.error);
      },
      async start() {
        const res = await emit('room:start');
        if (!res?.ok) showToast(res?.error);
      },
      async play(board) {
        const res = await emit('game:play', { board });
        if (!res?.ok) showToast(res?.error);
        return res;
      },
      async draw() {
        const res = await emit('game:draw');
        if (!res?.ok) showToast(res?.error);
        return res;
      },
      async endGame() {
        const res = await emit('game:end');
        if (!res?.ok) showToast(res?.error);
      },
      async getLeaderboard() {
        return emit('leaderboard:get');
      },
    },
    [showToast, meId]
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
