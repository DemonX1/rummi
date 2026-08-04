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
} from './lib/socket.js';
import { addGameScores, wasApplied, markApplied } from './lib/scores.js';

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

  useEffect(() => {
    socket.on('room', (s) => {
      setSnap(s);
      // Начислить накопленные очки один раз за завершённую партию
      if (s?.game?.phase === 'ended' && s.game.gameId && !wasApplied(s.game.gameId)) {
        addGameScores(s.game.players);
        markApplied(s.game.gameId);
      }
    });
    socket.on('error', showToast);

    // Восстановление после обновления страницы (refresh не должен сбрасывать игру)
    const sess = getSession();
    if (sess?.code) {
      emit('room:rejoin', { code: sess.code, id: meId, name: sess.name || 'Игрок' }).then((res) => {
        if (!res?.ok) clearSession();
      });
    }

    return () => {
      socket.off('room', setSnap);
      socket.off('error', showToast);
    };
  }, [showToast, meId]);

  const actions = useMemoActions(showToast, meId);

  if (snap?.game) {
    return (
      <>
        <Game snap={snap} meId={meId} actions={actions} />
        <Toast msg={toast} />
      </>
    );
  }

  if (snap?.code) {
    return (
      <>
        <Room
          snap={snap}
          meId={meId}
          actions={actions}
          onLeave={() => {
            clearSession();
            setSnap(null);
          }}
        />
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
        const res = await emit('room:create', { id: meId, name, addBot });
        if (!res?.ok) {
          showToast(res?.error || 'Не удалось создать комнату');
          return;
        }
        saveSession(res.snapshot.code, name.trim());
      },
      async join(code, name) {
        const res = await emit('room:join', { code, name, id: meId });
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
      async restart() {
        const res = await emit('room:restart');
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
    },
    [showToast, meId]
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
