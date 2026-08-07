import React, { useState } from 'react';
import { PLAYER_COLORS, PLAYER_EMOJIS, getProfile, saveProfile, markProfileTouched } from '../lib/socket.js';

export default function Home({ meId, actions }) {
  const [name, setName] = useState(localStorage.getItem('rummi-name') || '');
  const [code, setCode] = useState('');
  const [profile, setProfile] = useState(getProfile());
  const [leaders, setLeaders] = useState(null);

  const saveName = (n) => {
    setName(n);
    localStorage.setItem('rummi-name', n);
  };

  const updateProfile = (patch) => {
    markProfileTouched();
    const next = { ...profile, ...patch };
    setProfile(next);
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
                className={`color-swatch ${profile.color === c ? 'active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => updateProfile({ color: c })}
              />
            ))}
          </div>
          <span className="profile-label">Аватарка</span>
          <div className="emoji-row">
            {PLAYER_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className={`emoji-pick ${profile.emoji === e ? 'active' : ''}`}
                onClick={() => updateProfile({ emoji: e })}
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
      </div>

      <div className="rules-hint">
        Составьте группы на 30+ очков, выложите первые фишки и сосредоточьтесь на самом
        интересном — Румикубе!
      </div>

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
                    className={`score-row ${row.id === meId ? 'me' : ''}`}
                  >
                    <span className="leader-rank">#{i + 1}</span>
                    <span className="leader-avatar" style={{ background: row.color || '#7c3aed' }}>
                      {row.emoji || row.name[0]?.toUpperCase()}
                    </span>
                    <span className="score-name">{row.name}</span>
                    <span className="score-cell">{row.games ?? 0} игр</span>
                    <span className="score-cell score-total">{row.score}</span>
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
    </div>
  );
}