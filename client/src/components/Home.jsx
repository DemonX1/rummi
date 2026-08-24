import React, { useEffect, useState } from 'react';
import { PLAYER_COLORS, PLAYER_EMOJIS, getProfile, saveProfile, markProfileTouched } from '../lib/socket.js';
import ProfileModal from './ProfileModal.jsx';

export default function Home({ meId, actions, profile, onProfileChanged }) {
  const [name, setName] = useState(localStorage.getItem('rummi-name') || '');
  // Код комнаты из ссылки вида /?room=XXXXX подставляем сразу в поле.
  const [code, setCode] = useState(() => (new URLSearchParams(window.location.search).get('room') || '').toUpperCase());
  const [cameByLink, setCameByLink] = useState(() => !!new URLSearchParams(window.location.search).get('room'));
  const [avatar, setAvatar] = useState(getProfile());
  const [profileOpen, setProfileOpen] = useState(false);
  const [leaders, setLeaders] = useState(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get('room')) return;
    window.history.replaceState({}, '', window.location.pathname);
    // Подсказка показываем, только пока код не изменили вручную
    const t = setTimeout(() => setCameByLink(false), 15000);
    return () => clearTimeout(t);
  }, []);

  const saveName = (n) => {
    setName(n);
    localStorage.setItem('rummi-name', n);
  };

  const updateAvatar = (patch) => {
    markProfileTouched();
    const next = { ...avatar, ...patch };
    setAvatar(next);
    saveProfile(next);
  };

  const submit = (fn) => {
    if (!name.trim()) return;
    saveName(name.trim());
    fn();
  };

  const openLeaderboard = async () => {
    const res = await actions.getLeaderboard();
    setLeaders(res?.ok ? res.leaderboard : null);
  };

  const addFriend = async (friendId) => {
    const res = await actions.addFriend(friendId);
    if (res?.ok) onProfileChanged(res.profile);
  };

  const myProfileId = profile?.id || meId;
  const friendIds = new Set(profile?.friends || []);

  return (
    <div className="home">
      <div className="hero">
        <h1 className="logo">
          <span className="logo-tile t-r">1</span>
          <span className="logo-tile t-b">7</span>
          <span className="logo-tile t-k">13</span>
          <span className="logo-tile t-y">3</span>
          <span className="logo-text">Румикуб</span>
        </h1>
        <p className="tagline">Собери число, обыграй друзей или сразись с компьютером.</p>
      </div>

      <div className="panel auth-panel">
        <label className="field">
          <span>Ваше имя</span>
          <input
            value={name}
            maxLength={20}
            placeholder="Введите имя"
            onChange={(e) => saveName(e.target.value)}
          />
        </label>

        <div className="profile-picker">
          <span className="profile-label">Цвет</span>
          <div className="color-row">
            {PLAYER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch ${avatar.color === c ? 'active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => updateAvatar({ color: c })}
              />
            ))}
          </div>
          <span className="profile-label">Аватарка</span>
          <div className="emoji-row">
            {PLAYER_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className={`emoji-pick ${avatar.emoji === e ? 'active' : ''}`}
                onClick={() => updateAvatar({ emoji: e })}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg"
          disabled={!name.trim()}
          onClick={() => submit(() => actions.create(name.trim(), false))}
        >
          Создать комнату
        </button>
        <button
          className="btn btn-ghost btn-lg"
          disabled={!name.trim()}
          onClick={() => submit(() => actions.create(name.trim(), true))}
        >
          Играть с компьютером
        </button>

        <div className="divider"><span>или</span></div>

        <div className="join-row">
          <input
            value={code}
            maxLength={5}
            placeholder="Код комнаты"
            className="code-input"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            className="btn btn-accent"
            disabled={!name.trim() || code.trim().length < 4}
            onClick={() => submit(() => actions.join(code.trim(), name.trim()))}
          >
            Присоединиться
          </button>
        </div>
        {cameByLink && name.trim() && (
          <div className="link-hint">Комната {code} ждёт — введите имя и нажмите «Присоединиться».</div>
        )}      </div>

      <button className="btn btn-ghost leaderboard-btn" onClick={() => setProfileOpen(true)}>
        Мой профиль
      </button>

      <button className="btn btn-ghost leaderboard-btn" onClick={openLeaderboard}>
        Таблица лидеров
      </button>

      {leaders !== null && (
        <div className="modal-backdrop" onClick={() => setLeaders(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Таблица лидеров</h3>
            {leaders.length === 0 ? (
              <div className="empty-hint">Пока никто не набрал очков. Сыграйте первую партию!</div>
            ) : (
              <div className="leaderboard">
                {leaders.map((row, i) => (
                  <div
                    key={row.id}
                    className={`score-row ${row.id === myProfileId ? 'me' : ''}`}
                  >
                    <span className="leader-rank">#{i + 1}</span>
                    <span className="leader-avatar" style={{ background: row.color || '#7c3aed' }}>
                      {row.emoji || row.name[0]?.toUpperCase()}
                    </span>
                    <span className="score-name">{row.name}</span>
                    <span className="score-cell">{row.games ?? 0} игр</span>
                    <span className="score-cell score-total">{row.score}</span>
                    {row.id !== myProfileId && !friendIds.has(row.id) && (
                      <button
                        className="btn btn-sm friend-add"
                        title="Добавить в друзья"
                        onClick={() => addFriend(row.id)}
                      >
                        +
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-primary" onClick={() => setLeaders(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {profileOpen && (
        <ProfileModal
          profile={profile}
          actions={actions}
          onClose={() => setProfileOpen(false)}
          onChanged={onProfileChanged}
        />
      )}
    </div>
  );
}
