import React, { useEffect, useRef, useState } from 'react';
import Tile from './Tile.jsx';
import { isValidMeld, sortMeld, tileValue } from '../lib/melds.js';

const COLOR_RANK = { R: 0, B: 1, K: 2, Y: 3, JOKER: 4 };
const HAND_SORT_OPTIONS = [
  { key: 'none', label: 'Как пришло' },
  { key: 'color', label: 'По цвету' },
  { key: 'value', label: 'По возрастанию' },
  { key: 'colorValue', label: 'Цвет + число' },
];

// Сортировка — только отображение руки; порядок в самом массиве не меняется.
function sortHand(tiles, mode) {
  if (mode === 'none') return tiles;
  const valueRank = (t) => (t.color === 'JOKER' ? 14 : t.value);
  const arr = tiles.slice();
  if (mode === 'color') arr.sort((a, b) => COLOR_RANK[a.color] - COLOR_RANK[b.color]);
  else if (mode === 'value') arr.sort((a, b) => valueRank(a) - valueRank(b));
  else if (mode === 'colorValue') arr.sort((a, b) => COLOR_RANK[a.color] - COLOR_RANK[b.color] || valueRank(a) - valueRank(b));
  return arr;
}

function fmtSec(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}
function fmtMs(ms) {
  return fmtSec(Math.floor((ms || 0) / 1000));
}
function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default function Game({ snap, meId, actions, onExit }) {
  const game = snap.game;
  const you = game.you;
  const myTurn = game.phase === 'playing' && !!you?.yourTurn;

  const [board, setBoard] = useState([]);
  const [hand, setHand] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [moved, setMoved] = useState(new Set());
  const [showScores, setShowScores] = useState(false);
  const [handSort, setHandSort] = useState('none');
  const [actionBanner, setActionBanner] = useState(null); // { text, key, mine }
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const turnKeyRef = useRef(null);

  const turnKey = `${game.phase}:${game.turnIndex}:${you?.yourTurn}`;

  // Секундомер текущего хода (обнуляется при смене хода/фазы)
  const [turnSec, setTurnSec] = useState(0);
  const turnAnchorRef = useRef(Date.now());
  useEffect(() => {
    turnAnchorRef.current = Date.now();
    setTurnSec(0);
    if (game.phase !== 'playing') return;
    const t = setInterval(() => setTurnSec(Math.floor((Date.now() - turnAnchorRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [game.phase, game.turnIndex]);

  // Синхронизация с сервером: сбрасываем локальную правку при смене хода/фазы
  useEffect(() => {
    if (turnKeyRef.current !== turnKey) {
      turnKeyRef.current = turnKey;
      setBoard(game.board.map((m) => m.slice()));
      setHand(you ? you.hand.slice() : []);
      setSelected(new Set());
      setMoved(new Set());
      setUndoStack([]);
      setRedoStack([]);
      if (myTurn) {
        setActionBanner(null);
      }
    } else if (!myTurn) {
      setBoard(game.board.map((m) => m.slice()));
      setHand(you ? you.hand.slice() : []);
      setSelected(new Set());
      setMoved(new Set());
      setUndoStack([]);
      setRedoStack([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, game.board, myTurn]);

  // Баннер последнего действия соперника
  useEffect(() => {
    if (!you || myTurn || game.phase !== 'playing') return;

    const last = game.log && game.log[game.log.length - 1];
    if (last && isActionLine(last)) {
      const myName = (game.players.find((p) => p.id === meId) || {}).name || '';
      setActionBanner({ text: last, key: game.log.length, mine: !!myName && last.includes(myName) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.log, myTurn]);

  // Последние выложенные фишки каждого игрока (кто что выложил в своём последнем ходу)
  const played = game.phase === 'playing' ? (game.played || []) : [];
  const ownerByTile = new Map();
  for (const entry of played) {
    for (const id of entry.tileIds) ownerByTile.set(id, entry);
  }

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

  const snapshot = () => ({ board: board.map((m) => m.slice()), hand: hand.slice(), moved: new Set(moved) });

  const pushUndo = () => {
    setUndoStack([...undoStack, snapshot()]);
    setRedoStack([]);
  };

  const undo = () => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setRedoStack([...redoStack, snapshot()]);
    setBoard(last.board);
    setHand(last.hand);
    setMoved(new Set(last.moved));
    setSelected(new Set());
    setUndoStack(undoStack.slice(0, -1));
  };

  const redo = () => {
    if (!redoStack.length) return;
    const last = redoStack[redoStack.length - 1];
    setUndoStack([...undoStack, snapshot()]);
    setBoard(last.board);
    setHand(last.hand);
    setMoved(new Set(last.moved));
    setSelected(new Set());
    setRedoStack(redoStack.slice(0, -1));
  };

  const createMeld = () => {
    const tiles = selectedTiles();
    if (!tiles.length) return;
    const ids = new Set(tiles.map((t) => t.id));
    pushUndo();
    setBoard([...board.filter((m) => !m.some((t) => ids.has(t.id))), sortMeld(tiles)]);
    const nextHand = hand.filter((t) => !ids.has(t.id));
    if (nextHand.length !== hand.length) {
      const n = new Set(moved);
      tiles.forEach((t) => n.add(t.id));
      setMoved(n);
    }
    setHand(nextHand);
    setSelected(new Set());
  };

  const addToMeld = (i) => {
    const tiles = selectedTiles();
    if (!tiles.length) return;
    const already = new Set(board[i].map((t) => t.id));
    const fresh = tiles.filter((t) => !already.has(t.id));
    if (!fresh.length) {
      setSelected(new Set());
      return;
    }
    const ids = new Set(fresh.map((t) => t.id));
    pushUndo();
    setBoard(board.map((m, mi) => (mi === i ? sortMeld([...m, ...fresh]) : m.filter((t) => !ids.has(t.id)))).filter((m) => m.length > 0));
    const nextHand = hand.filter((t) => !ids.has(t.id));
    if (nextHand.length !== hand.length) {
      const n = new Set(moved);
      fresh.forEach((t) => n.add(t.id));
      setMoved(n);
    }
    setHand(nextHand);
    setSelected(new Set());
  };

  const reset = () => {
    setBoard(game.board.map((m) => m.slice()));
    setHand(you ? you.hand.slice() : []);
    setSelected(new Set());
    setMoved(new Set());
    setUndoStack([]);
    setRedoStack([]);
  };

  const play = async () => {
    setUndoStack([]);
    setRedoStack([]);
    await actions.play(board.map((m) => m.slice()));
  };
  const draw = async () => {
    setUndoStack([]);
    setRedoStack([]);
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
      <TopBar game={game} snap={snap} meId={meId} turnSec={turnSec} onOpenScores={() => setShowScores(true)} onEndGame={endGame} />

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
                        ownerByTile={ownerByTile}
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
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onCreate={createMeld}
              onReset={reset}
              onUndo={undo}
              onRedo={redo}
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

        <div className="rack-toolbar">
          <div className="hand-sort">
            {HAND_SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`sort-opt ${handSort === o.key ? 'active' : ''}`}
                onClick={() => setHandSort(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
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
            sortHand(hand, handSort).map((t) => (
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

function TopBar({ game, snap, meId, turnSec, onOpenScores, onEndGame }) {
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
              <span className="chip-avatar" style={{ background: p.color || '#7c3aed' }}>
                {p.emoji || p.name[0]?.toUpperCase()}
              </span>
              <span className="chip-name">{p.name}{p.id === meId ? ' (вы)' : ''}</span>
              <span className="chip-meta">
                {game.phase === 'ended'
                  ? `Очки: ${p.score > 0 ? '+' : ''}${p.score} · Σ ${p.total}`
                  : `${p.handCount} ф. · Σ ${p.total}`}
              </span>
              {isTurn && (
                <span className="turn-timer">
                  <ClockIcon />
                  {fmtSec(turnSec)}
                </span>
              )}
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

function BoardRegion({ board, myTurn, selected, onTile, onAddToMeld, ownerByTile }) {
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
              {sorted.map((t) => {
                const owner = ownerByTile.get(t.id);
                return (
                  <div key={t.id} className="tile-cell">
                    <Tile
                      tile={t}
                      size="md"
                      dimmed={!myTurn}
                      selected={selected.has(t.id)}
                      onClick={() => onTile(t.id)}
                      className={owner ? 'tile-new' : undefined}
                    />
                    {owner && (
                      <span
                        className="tile-owner"
                        style={{ background: owner.color }}
                        title={`${owner.name} выложил фишку`}
                      >
                        {owner.emoji}
                      </span>
                    )}
                  </div>
                );
              })}
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
  canDraw, canPlay, hasSelection, hasEdits, isFirstMeld, deltaSum, placedCount, canUndo, canRedo,
  onCreate, onReset, onUndo, onRedo, onPlay, onDraw,
}) {
  return (
    <div className="controls">
      <div className="controls-left">
        <button className="btn btn-ghost btn-sm" disabled={!hasSelection} onClick={onCreate}>
          Новая группа
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!canUndo} onClick={onUndo} title="Отменить последнее действие">
          Отменить
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!canRedo} onClick={onRedo} title="Вернуть отменённое действие">
          Вернуть
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
  const rows = game.players
    .map((p) => ({ p, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
  });
  return (
    <div className="controls end-panel">
      <div className="end-title">{winner ? `Победил ${winner.name}!` : 'Игра завершена досрочно'}</div>
      <div className="end-table">
        <div className="end-table-row end-table-head">
          <span className="end-place">Место</span>
          <span className="end-name">Игрок</span>
          <span className="end-cell">Очки</span>
          <span className="end-cell end-time"><ClockIcon /> Время на ходы</span>
        </div>
        {rows.map(({ p, rank }) => (
          <div key={p.id} className={`end-table-row ${p.id === game.winnerId ? 'win' : ''}`}>
            <span className="end-place">{rank}</span>
            <span className="end-name">{p.name}{p.ai ? ' (бот)' : ''}</span>
            <span className="end-cell">{p.score > 0 ? `+${p.score}` : p.score}</span>
            <span className="end-time">{fmtMs(p.think)}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" onClick={onExit}>
        Выйти в меню
      </button>
    </div>
  );
}