import React, { useState } from 'react';
import { getScore } from '../lib/scores.js';

const DIFFICULTY = {
  easy: 'Лёгкий',
  medium: 'Средний',
  hard: 'Сложный',
};

export default function Room({ snap, meId, actions, onLeave }) {
  const [copied, setCopied] = useState(false);
  const isHost = snap.hostId === meId;
  const botCount = snap.players.filter((p) => p.ai).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snap.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="room">
      <button className="btn btn-ghost btn-sm leave-btn" onClick={() => { actions.leave(); onLeave(); }}>
        ← Выйти
      </button>

      <div className="panel room-panel">
        <div className="room-header">
          <h2>Комната</h2>
          <div className="room-code" onClick={copy} title="Скопировать">
            <span>Код: </span>
            <b>{snap.code}</b>
            <small>{copied ? 'скопировано' : 'нажмите, чтобы скопировать'}</small>
          </div>
        </div>

        <div className="players-list">
          {snap.players.map((p) => (
            <div key={p.id} className={`player-row ${p.id === snap.hostId ? 'host' : ''}`}>
              <span className="player-avatar">{p.name[0]?.toUpperCase()}</span>
              <span className="player-name">{p.name}</span>
              <span className="badge badge-score">Σ {getScore(p.id)}</span>
              {p.ai && <span className="badge badge-bot">Бот</span>}
              {p.id === snap.hostId && <span className="badge badge-host">Хост</span>}
              {!p.connected && <span className="badge badge-off">отключён</span>}
              {isHost && p.ai && (
                <button className="btn btn-sm btn-danger" onClick={() => actions.removeBot(p.id)}>
                  Убрать
                </button>
              )}
            </div>
          ))}
        </div>

        {isHost && (
          <div className="room-controls">
            <button className="btn btn-ghost" onClick={actions.addBot}>
              + Добавить бота
            </button>
            <label className="difficulty">
              <span>Сложность ботов</span>
              <select value={snap.settings.difficulty} onChange={(e) => actions.setDifficulty(e.target.value)}>
                {Object.entries(DIFFICULTY).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <button
          className="btn btn-primary btn-lg start-btn"
          disabled={!isHost || snap.players.length < 2}
          onClick={actions.start}
        >
          {isHost ? 'Начать игру' : 'Ожидание хоста…'}
        </button>
        {snap.players.length < 2 && (
          <div className="start-hint">Добавьте бота или пригласите друга по коду.</div>
        )}
      </div>
    </div>
  );
}