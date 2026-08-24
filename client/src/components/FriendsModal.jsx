import React, { useEffect, useState } from 'react';

export default function FriendsModal({ snap, actions, onClose }) {
  const [friends, setFriends] = useState(null);
  const [sentTo, setSentTo] = useState(new Set());
  const [copied, setCopied] = useState(false);

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

  const invite = async (f) => {
    const res = await actions.invite(f.id);
    if (res?.ok) setSentTo((prev) => new Set(prev).add(f.id));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?room=${snap.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const seated = new Set(snap.players.map((p) => p.id));
  const link = `${window.location.origin}/?room=${snap.code}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Пригласить в комнату</h3>

        <div className="share-row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-accent btn-sm" onClick={copyLink}>
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>

        <h4>Друзья</h4>
        {friends === null ? (
          <div className="empty-hint">Загрузка…</div>
        ) : friends.length === 0 ? (
          <div className="empty-hint">Друзей пока нет. Добавляйте их кнопкой «+» в таблице лидеров.</div>
        ) : (
          <div className="pm-friends">
            {friends.map((f) => {
              const inRoom = seated.has(f.id);
              return (
                <div key={f.id} className="friend-row">
                  <span className={`friend-dot ${f.online ? 'online' : ''}`} title={f.online ? 'в сети' : 'не в сети'} />
                  <span className="player-avatar" style={{ background: f.color || '#7c3aed' }}>
                    {f.emoji || f.name[0]?.toUpperCase()}
                  </span>
                  <span className="friend-name">{f.name}{f.me ? ' (вы)' : ''}</span>
                  {inRoom ? (
                    <span className="badge badge-host">в комнате</span>
                  ) : sentTo.has(f.id) ? (
                    <span className="badge badge-games">приглашён</span>
                  ) : (
                    <button className="btn btn-sm btn-primary" disabled={!f.online} title={f.online ? '' : 'Не в сети'} onClick={() => invite(f)}>
                      Пригласить
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button className="btn btn-primary" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
