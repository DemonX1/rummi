import React, { useCallback, useEffect, useRef, useState } from 'react';
import Home from './components/Home.jsx';
import Room from './components/Room.jsx';
import Game from './components/Game.jsx';
import {
  socket,
  emit,
  getPlayerId,
  getCachedProfileId,
  cacheProfileId,
  getSession,
  saveSession,
  clearSession,
  getProfile,
  syncProfileFromServer,
} from './lib/socket.js';

export default function App() {
  const [snap, setSnap] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // Профиль с сервера (статистика, устройства, друзья) и приглашение в комнату.
  const [profile, setProfile] = useState(null);
  const [invite, setInvite] = useState(null);

  const meId = getPlayerId();
  // Комнаты и статистика ключуются на серверный profileId; до первого ответа
  // сервера используем кэш, затем — device id.
  const myId = profile?.id || getCachedProfileId() || meId;

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshProfile = useCallback(async () => {
    const res = await emit('profile:get', { id: meId });
    if (!res?.ok) return;
    setProfile(res.profile);
    cacheProfileId(res.profile?.id || null);
  }, [meId]);

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
      touched: prof.touched,
    }).then((res) => {
      if (!res?.ok) {
        clearSession();
        return;
      }
      cacheProfileId(res.profileId || null);
      refreshProfile();
    });
  }, [meId, refreshProfile]);

  useEffect(() => {
    socket.on('room', (s) => {
      setSnap(s);
    });
    socket.on('error', showToast);
    socket.on('connect', tryRejoin);
    socket.on('connect', refreshProfile);
    socket.on('invite', (inv) => setInvite(inv));

    refreshProfile();
    tryRejoin();

    return () => {
      socket.off('room', setSnap);
      socket.off('error', showToast);
      socket.off('connect', tryRejoin);
      socket.off('connect', refreshProfile);
      socket.off('invite');
    };
  }, [showToast, tryRejoin, refreshProfile]);

  const actions = useMemoActions(showToast, meId);

  const exitToHome = useCallback(async () => {
    await actions.leave();
    clearSession();
    setSnap(null);
  }, [actions]);

  const acceptInvite = useCallback(
    async (inv) => {
      setInvite(null);
      const name = localStorage.getItem('rummi-name') || inv.from.name || 'Игрок';
      await actions.join(inv.code, name);
    },
    [actions]
  );

  if (snap?.game) {
    return (
      <>
        <Game snap={snap} meId={myId} actions={actions} onExit={exitToHome} />
        {invite && <InviteModal invite={invite} onAccept={acceptInvite} onDecline={() => setInvite(null)} />}
        <Toast msg={toast} />
      </>
    );
  }

  if (snap?.code) {
    return (
      <>
        <Room snap={snap} meId={myId} actions={actions} onLeave={exitToHome} />
        {invite && <InviteModal invite={invite} onAccept={acceptInvite} onDecline={() => setInvite(null)} />}
        <Toast msg={toast} />
      </>
    );
  }

  return (
    <>
      <Home meId={myId} actions={actions} profile={profile} onProfileChanged={setProfile} />
      {invite && <InviteModal invite={invite} onAccept={acceptInvite} onDecline={() => setInvite(null)} />}
      <Toast msg={toast} />
    </>
  );
}

function InviteModal({ invite, onAccept, onDecline }) {
  return (
    <div className="modal-backdrop" onClick={onDecline}>
      <div className="modal invite-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Приглашение в игру</h3>
        <div className="invite-from">
          <span className="player-avatar" style={{ background: invite.from.color || '#7c3aed' }}>
            {invite.from.emoji || invite.from.name[0]?.toUpperCase()}
          </span>
          <span>
            <b>{invite.from.name}</b> приглашает вас в комнату
          </span>
        </div>
        <div className="invite-code">{invite.code}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onDecline}>
            Позже
          </button>
          <button className="btn btn-primary" onClick={() => onAccept(invite)}>
            Присоединиться
          </button>
        </div>
      </div>
    </div>
  );
}

function useMemoActions(showToast, meId) {
  return useCallback(
    {
      async create(name, addBot) {
        const prof = getProfile();
        const res = await emit('room:create', {
          id: meId, name, addBot, color: prof.color, emoji: prof.emoji, touched: prof.touched,
        });
        if (!res?.ok) {
          showToast(res?.error || 'Не удалось создать комнату');
          return;
        }
        cacheProfileId(res.profileId || null);
        const me = res.snapshot.players.find((p) => p.id === res.profileId);
        if (me) syncProfileFromServer(me.color, me.emoji);
        saveSession(res.snapshot.code, name.trim());
      },
      async join(code, name) {
        const prof = getProfile();
        const res = await emit('room:join', {
          code, name, id: meId, color: prof.color, emoji: prof.emoji, touched: prof.touched,
        });
        if (!res?.ok) {
          showToast(res?.error || 'Не удалось присоединиться');
          return;
        }
        cacheProfileId(res.profileId || null);
        const me = res.snapshot.players.find((p) => p.id === res.profileId);
        if (me) syncProfileFromServer(me.color, me.emoji);
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
      // --- Профили ---
      async createLinkCode() {
        return emit('profile:code:create', { id: meId });
      },
      async linkByCode(code) {
        return emit('profile:link', { id: meId, code });
      },
      async unlinkDevice(deviceId) {
        return emit('profile:unlink', { id: meId, deviceId });
      },
      async addFriend(friendId) {
        return emit('profile:friends:add', { id: meId, friendId });
      },
      async removeFriend(friendId) {
        return emit('profile:friends:remove', { id: meId, friendId });
      },
      async listFriends() {
        return emit('profile:friends:list', { id: meId });
      },
      async invite(toPid) {
        return emit('room:invite', { toPid });
      },
    },
    [showToast, meId]
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
