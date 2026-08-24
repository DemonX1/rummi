import React, { useEffect, useState } from 'react';

const GAME = 'rummikub';

function fmtDate(ts) {
  const d = new Date(ts);
  if (!ts) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function ProfileModal({ profile, actions, onClose, onChanged }) {
  const [linkCode, setLinkCode] = useState(null); // { code, expiresAt }
  const [foreignCode, setForeignCode] = useState('');
  const [status, setStatus] = useState(null); // { ok, text }
  const [friends, setFriends] = useState(null);

  useEffect(() => {
    let alive = true;
    actions.listFriends().then((res) => {
      if (alive && res?.ok) setFriends(res.friends);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = profile?.stats?.[GAME] || { total: 0, games: 0, wins: 0, bestWin: 0, byPlayers: {}, history: [] };
  const winrate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
  const devices = profile?.devices || [];
  const history = [...(s.history || [])].reverse();

  const makeCode = async () => {
    const res = await actions.createLinkCode();
    if (!res?.ok) {
      setStatus({ ok: false, text: res?.error || 'Не удалось создать код' });
      return;
    }
    setLinkCode(res);
    setStatus(null);
  };

  const submitForeignCode = async () => {
    const c = foreignCode.trim().toUpperCase();
    if (c.length < 4) return;
    const res = await actions.linkByCode(c);
    if (!res?.ok) {
      setStatus({ ok: false, text: res?.error || 'Не удалось привязать профиль' });
      return;
    }
    onChanged(res.profile);
    setStatus({ ok: true, text: 'Профиль привязан к этому устройству' });
    setForeignCode('');
  };

  const unlink = async (deviceId) => {
    const res = await actions.unlinkDevice(deviceId);
    if (!res?.ok) {
      setStatus({ ok: false, text: res?.error || 'Ошибка' });
      return;
    }
    onChanged(res.profile);
    setStatus(null);
  };

  const removeFriend = async (fid) => {
    const res = await actions.removeFriend(fid);
    if (res?.ok) {
      setFriends((prev) => (prev || []).filter((f) => f.id !== fid));
      onChanged({ ...(profile || {}), friends: (profile?.friends || []).filter((x) => x !== fid) });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Мой профиль</h3>

        <div className="pm-head">
          <span className="player-avatar" style={{ background: profile?.color || '#7c3aed' }}>
            {profile?.emoji || '?'}
          </span>
          <div>
            <div className="pm-name">{profile?.name || 'Игрок'}</div>
            <div className="pm-sub">
              {s.total} очков · {s.games} партий
            </div>
          </div>
        </div>

        <div className="pm-section">
          <h4>Статистика</h4>
          <div className="pm-stats-grid">
            <div className="pm-stat"><b>{s.total}</b><span>очки</span></div>
            <div className="pm-stat"><b>{s.games}</b><span>партий</span></div>
            <div className="pm-stat"><b>{s.wins}</b><span>побед</span></div>
            <div className="pm-stat"><b>{winrate}%</b><span>винрейт</span></div>
            <div className="pm-stat"><b>+{s.bestWin}</b><span>лучший выигрыш</span></div>
          </div>
          {Object.keys(s.byPlayers || {}).length > 0 && (
            <div className="pm-bycount">
              {Object.entries(s.byPlayers).sort(([a], [b]) => a - b).map(([n, b]) => (
                <span key={n} className="badge badge-games">
                  {n} игрока: {b.games} партий · {b.wins} побед
                </span>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <div className="pm-history">
              {history.map((h, i) => (
                <div key={i} className={`pm-hist-row ${h.place === 1 ? 'win' : ''}`}>
                  <span className="pm-hist-place">#{h.place}</span>
                  <span className="pm-hist-score">{h.score > 0 ? `+${h.score}` : h.score}</span>
                  <span className="pm-hist-meta">{h.players} игрока</span>
                  <span className="pm-hist-date">{fmtDate(h.at)}</span>
                </div>
              ))}
            </div>
          )}
          {s.games === 0 && <div className="empty-hint">Сыграйте первую партию — статистика появится здесь.</div>}
        </div>

        <div className="pm-section">
          <h4>Устройства ({devices.length})</h4>
          <p className="pm-hint">Один профиль — несколько устройств. Введите код на другом устройстве, чтобы играть под этим профилем.</p>
          <div className="pm-devices">
            {devices.map((d) => (
              <div key={d} className="pm-device-row">
                <span className="pm-device-id">{d}</span>
                {devices.length > 1 && (
                  <button className="btn btn-sm btn-danger" title="Отвязать устройство" onClick={() => unlink(d)}>
                    Отвязать
                  </button>
                )}
              </div>
            ))}
          </div>
          {linkCode ? (
            <div className="link-code-box">
              <span className="pm-hint">Код для другого устройства (действует 10 минут):</span>
              <b className="link-code">{linkCode.code}</b>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={makeCode}>
              Получить код привязки
            </button>
          )}
          <div className="pm-input-row">
            <input
              value={foreignCode}
              maxLength={6}
              placeholder="Код с другого устройства"
              onChange={(e) => setForeignCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submitForeignCode()}
            />
            <button className="btn btn-accent btn-sm" disabled={foreignCode.trim().length < 4} onClick={submitForeignCode}>
              Привязать
            </button>
          </div>
        </div>

        <div className="pm-section">
          <h4>Друзья</h4>
          {friends === null ? (
            <div className="empty-hint">Загрузка…</div>
          ) : friends.length === 0 ? (
            <div className="empty-hint">Добавляйте друзей кнопкой «+» в таблице лидеров.</div>
          ) : (
            <div className="pm-friends">
              {friends.map((f) => (
                <div key={f.id} className="friend-row">
                  <span className={`friend-dot ${f.online ? 'online' : ''}`} title={f.online ? 'в сети' : 'не в сети'} />
                  <span className="player-avatar" style={{ background: f.color || '#7c3aed' }}>
                    {f.emoji || f.name[0]?.toUpperCase()}
                  </span>
                  <span className="friend-name">{f.name}{f.me ? ' (вы)' : ''}</span>
                  {!f.me && (
                    <button className="btn btn-sm btn-danger" title="Убрать из друзей" onClick={() => removeFriend(f.id)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {status && <div className={`pm-status ${status.ok ? 'ok' : 'err'}`}>{status.text}</div>}

        <button className="btn btn-primary" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
