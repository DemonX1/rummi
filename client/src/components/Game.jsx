import React, { useEffect, useRef, useState } from 'react';
import Tile from './Tile.jsx';
import { isValidMeld, sortMeld, tileValue } from '../lib/melds.js';

export default function Game({ snap, meId, actions, onExit }) {
  const game = snap.game;
  const you = game.you;
  const myTurn = game.phase === 'playing' && !!you?.yourTurn;

  const [board, setBoard] = useState([]);
  const [hand, setHand] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [moved, setMoved] = useState(new Set());
  const [showScores, setShowScores] = useState(false);
  const [justPlayed, setJustPlayed] = useState(new Set()); // tileId — новые фишки соперника
  const [actionBanner, setActionBanner] = useState(null); // { text, key, mine }
  const turnKeyRef = useRef(null);
  const prevBoardIdsRef = useRef([]);

  const turnKey = `${game.phase}:${game.turnIndex}:${you?.yourTurn}`;

  // Синхронизация с сервером: сбрасываем локальную правку при смене хода/фазы
  useEffect(() => {
    if (turnKeyRef.current !== turnKey) {
      turnKeyRef.current = turnKey;
      setBoard(game.board.map((m) => m.slice()));
      setHand(you ? you.hand.slice() : []);
      setSelected(new Set());
      setMoved(new Set());
      if (myTurn) {
        setJustPlayed(new Set());
        setActionBanner(null);
      }
    } else if (!myTurn) {
      setBoard(game.board.map((m) => m.slice()));
      setHand(you ? you.hand.slice() : []);
      setSelected(new Set());
      setMoved(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, game.board, myTurn]);

  // Наблюдение за ходами соперника: подсвечиваем новые фишки и показываем баннер последнего действия
  useEffect(() => {
    if (!you || myTurn || game.phase !== 'playing') return;

    const curIds = game.board.flat().map((t) => t.id);
    const prevSet = new Set(prevBoardIdsRef.current);
    const added = curIds.filter((id) => !prevSet.has(id));
    if (added.length) {
      setJustPlayed((prev) => new Set([...prev, ...added]));
    }
    prevBoardIdsRef.current = curIds;

    const last = game.log && game.log[game.log.length - 1];
    if (last && isActionLine(last)) {
      const myName = (game.players.find((p) => p.id === meId) || {}).name || '';
      setActionBanner({ text: last, key: game.log.length, mine: !!myName && last.includes(myName) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.log, game.board, myTurn]);

  const toggleSelect = (id) => {
    if (!myTurn) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectedTiles = () => {
    const map = new Map();
    for (const m of board) for (const t of m) map.set(t.id, t);
    for (const t of hand) if (!map.has(t.id)) map.set(t.id, t);
    return [...selected].map((id) => map.get(id)).filter(Boolean);
  };

  const removeFromSources = (tiles, keepMeldIndex) => {
    const ids = new Set(tiles.map((t) => t.id));
    setBoard((prev) =>
      prev
        .map((m, mi) => (mi === keepMeldIndex ? m : m.filter((t) => !ids.has(t.id))))
        .filter((m) => m.length > 0)
    );
    setHand((prev) => {
      const next = prev.filter((t) => !ids.has(t.id));
      if (next.length !== prev.length) {
        setMoved((m) => {
          const n = new Set(m);
          tiles.forEach((t) => n.add(t.id));
          return n;
        });
      }
      return next;
    });
  };

  const createMeld = () => {
    const tiles = selectedTiles();
    if (!tiles.length) return;
    const idx = board.length;
    setBoard((prev) => [...prev, sortMeld(tiles)]);
    setSelected(new Set());
    removeFromSources(tiles, idx);
  };

  const addToMeld = (i) => {
    const tiles = selectedTiles();
    if (!tiles.length) return;
    const already = new Set(board[i].map((t) => t.id));
    const fresh = tiles.filter((t) => !already.has(t.id));
    setSelected(new Set());
    if (!fresh.length) return;
    setBoard((prev) => prev.map((m, mi) => (mi === i ? sortMeld([...m, ...fresh]) : m)));
    removeFromSources(fresh, i);
  };

  const reset = () => {
    setBoard(game.board.map((m) => m.slice()));
    setHand(you ? you.hand.slice() : []);
    setSelected(new Set());
    setMoved(new Set());
  };

  const play = async () => {
    await actions.play(board.map((m) => m.slice()));
  };
  const draw = async () => {
    await actions.draw();
  };
  const endGame = () => {
    if (window.confirm('Завершить игру досрочно? Очки за партию не начисляются, победитель не определяется.')) {
      actions.endGame();
    }
  };

  const validBoard = board.length > 0 && board.every((m) => isValidMeld(m));
  const deltaSum = [...moved].reduce((s, id) => {
    for (const m of board) {
      const t = m.find((x) => x.id === id);
      if (t) return s + tileValue(t);
    }
    return s;
  }, 0);

  return (
    <div className="game">
      <TopBar game={game} snap={snap} meId={meId} onOpenScores={() => setShowScores(true)} onEndGame={endGame} />

      <div className="game-body">
        {actionBanner && (
          <div key={actionBanner.key} className={`action-banner ${actionBanner.mine ? 'mine' : ''}`}>
            {actionBanner.text}
          </div>
        )}
        <div className="board">
          <BoardRegion
            board={board}
            myTurn={myTurn}
            selected={selected}
            onTile={toggleSelect}
            onAddToMeld={addToMeld}
            justPlayed={justPlayed}
          />
          <OpponentHands game={game} meId={meId} />
        </div>

        <div className="control-strip">
          {game.phase === 'ended' ? (
            <EndPanel game={game} meId={meId} onExit={onExit} />
          ) : myTurn ? (
            <Controls
              canDraw={moved.size === 0}
              canPlay={moved.size > 0 && validBoard}
              hasSelection={selected.size > 0}
              hasEdits={moved.size > 0 || selected.size > 0}
              isFirstMeld={!you.melded}
              deltaSum={deltaSum}
              placedCount={moved.size}
              onCreate={createMeld}
              onReset={reset}
              onPlay={play}
              onDraw={draw}
            />
          ) : (
            <div className="waiting">
              Ходит {game.players[game.turnIndex].name}
              {game.players[game.turnIndex].ai ? ' (компьютер)' : ''}…
            </div>
          )}
        </div>

        <div className={`rack ${myTurn ? '' : 'rack-locked'}`}>
          {hand.length === 0 ? (
            <div className="rack-empty">
              {game.phase === 'ended'
                ? game.winnerId === meId
                  ? 'Вы победили!'
                  : 'Игра окончена'
                : 'Рука пуста'}
            </div>
          ) : (
            hand.map((t) => (
              <Tile
                key={t.id}
                tile={t}
                size="lg"
                dimmed={!myTurn}
                selected={selected.has(t.id)}
                onClick={() => toggleSelect(t.id)}
              />
            ))
          )}
        </div>
      </div>

      {showScores && <Scoreboard game={game} onClose={() => setShowScores(false)} />}
    </div>
  );
}

function TopBar({ game, snap, meId, onOpenScores, onEndGame }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isHost = snap.hostId === meId;
  const canEnd = isHost && game.phase === 'playing';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="menu-wrap">
          <button
            className="btn btn-ghost menu-btn"
            title="Меню"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋮
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu-dropdown">
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenScores();
                  }}
                >
                  Таблица очков
                </button>
                {canEnd && (
                  <button
                    className="menu-item menu-item-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onEndGame();
                    }}
                  >
                    Завершить игру досрочно
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="topbar-title">
          <span className="logo-mini">Румикуб</span>
          <span className="room-code-mini">Комната {snap.code}</span>
        </div>
      </div>
      <div className="players-bar">
        {game.players.map((p, i) => {
          const isTurn = game.turnIndex === i && game.phase === 'playing';
          return (
            <div key={p.id} className={`player-chip ${isTurn ? 'turn' : ''} ${p.id === meId ? 'me' : ''}`}>
              <span className="chip-avatar">{p.name[0]?.toUpperCase()}</span>
              <span className="chip-name">{p.name}{p.id === meId ? ' (вы)' : ''}</span>
              <span className="chip-meta">
                {game.phase === 'ended'
                  ? `Очки: ${p.score > 0 ? '+' : ''}${p.score} · Σ ${p.total}`
                  : `${p.handCount} ф. · Σ ${p.total}`}
              </span>
            </div>
          );
        })}
      </div>
    </header>
  );
}

function Scoreboard({ game, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Таблица очков</h3>
        <div className="scoreboard">
          {game.players.map((p) => (
            <div key={p.id} className="score-row">
              <span className="score-name">{p.name}{p.ai ? ' (бот)' : ''}</span>
              <span className="score-cell">в руке: {p.handCount} ф.</span>
              <span className="score-cell">
                за партию: {p.score > 0 ? `+${p.score}` : p.score}
              </span>
              <span className="score-cell score-total">Σ накоплено: {p.total}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

function isActionLine(line) {
  return !/^(Ходит |Игра началась|Игра окончена|Победитель)/.test(line);
}

function BoardRegion({ board, myTurn, selected, onTile, onAddToMeld, justPlayed }) {
  if (board.length === 0) {
    return (
      <div className="board-empty">
        <p>Стол пуст.</p>
        <p className="hint-text">
          Выберите фишки на руке и нажмите «Новая группа» или «+» на группе, чтобы выложить первые фишки.
          Первая выкладка должна набирать 30+ очков.
        </p>
      </div>
    );
  }
  return (
    <div className="board-melds">
      {board.map((meld, i) => {
        const sorted = sortMeld(meld);
        const valid = isValidMeld(sorted);
        return (
          <div key={`${i}-${meld[0]?.id}`} className={`meld ${valid ? '' : 'invalid'}`}>
            {myTurn && (
              <button
                className="meld-add"
                title="Добавить выделенные фишки в эту группу"
                onClick={() => onAddToMeld(i)}
              >
                +
              </button>
            )}
            <div className="meld-tiles">
              {sorted.map((t) => (
                <Tile
                  key={t.id}
                  tile={t}
                  size="md"
                  dimmed={!myTurn}
                  selected={selected.has(t.id)}
                  onClick={() => onTile(t.id)}
                  className={justPlayed.has(t.id) ? 'tile-new' : undefined}
                />
              ))}
            </div>
            {!valid && <span className="meld-bad">некорректная группа</span>}
          </div>
        );
      })}
    </div>
  );
}

function OpponentHands({ game, meId }) {
  const others = game.players.filter((p) => p.id !== meId);
  return (
    <div className="opponents">
      {others.map((p) => (
        <span key={p.id} className={`opponent ${p.ai ? 'opponent-bot' : ''}`}>
          {p.name}: {p.handCount} ф.
        </span>
      ))}
    </div>
  );
}

function Controls({
  canDraw, canPlay, hasSelection, hasEdits, isFirstMeld, deltaSum, placedCount,
  onCreate, onReset, onPlay, onDraw,
}) {
  return (
    <div className="controls">
      <div className="controls-left">
        <button className="btn btn-ghost btn-sm" disabled={!hasSelection} onClick={onCreate}>
          Новая группа
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!hasEdits} onClick={onReset}>
          Сброс
        </button>
      </div>
      <div className="controls-hint">
        {isFirstMeld && (
          <span>
            Первая выкладка: <b>{deltaSum}/30</b> очков
          </span>
        )}
        {!isFirstMeld && placedCount > 0 && <span>Выложено: {placedCount} ф.</span>}
      </div>
      <div className="controls-right">
        <button className="btn btn-accent" disabled={!canDraw} onClick={onDraw}>
          Взять фишку
        </button>
        <button className="btn btn-primary" disabled={!canPlay} onClick={onPlay}>
          Сыграть
        </button>
      </div>
    </div>
  );
}

function EndPanel({ game, meId, onExit }) {
  const winner = game.players.find((p) => p.id === game.winnerId);
  return (
    <div className="controls end-panel">
      <div className="end-title">{winner ? `Победил ${winner.name}!` : 'Игра завершена досрочно'}</div>
      <div className="end-scores">
        {game.players.map((p) => (
          <span key={p.id} className={p.id === game.winnerId ? 'win' : ''}>
            {p.name}: {p.score > 0 ? `+${p.score}` : p.score} · Σ {p.total}
          </span>
        ))}
      </div>
      <button className="btn btn-primary" onClick={onExit}>
        Выйти в меню
      </button>
    </div>
  );
}