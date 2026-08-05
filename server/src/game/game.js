import { createDeck, isJoker, tilePoints } from './melds.js';
import { isValidMeld } from './melds.js';

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const HAND_SIZE = 14;

export class Game {
  /**
   * @param players [{id, name, ai}] — список игроков
   * @param difficulty 'easy' | 'medium' | 'hard' — влияет на силу ботов
   */
  constructor(players, difficulty = 'medium') {
    this.difficulty = difficulty;
    const deck = shuffle(createDeck());
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      ai: !!p.ai,
      connected: true,
      hand: deck.splice(0, HAND_SIZE),
      melded: false, // выложил ли первую комбинацию на 30+ очков
      score: 0,
    }));
    this.stock = deck;
    this.discard = [];
    this.board = []; // массив групп (каждая группа — массив фишек)
    this.turnIndex = 0;
    this.turnDrew = false;
    this.phase = 'playing'; // 'playing' | 'ended'
    this.winner = null;
    this.log = [`Игра началась. Ходит ${this.players[0].name}.`];
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  currentPlayer() {
    return this.players[this.turnIndex];
  }

  isCurrent(playerId) {
    return this.players[this.turnIndex]?.id === playerId;
  }

  advanceTurn() {
    this.turnDrew = false;
    if (this.players.length <= 1) return;
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }

  finish() {
    this.phase = 'ended';
    const others = this.players.filter((p) => p.id !== this.winner.id);
    const penaltySum = others.reduce((s, p) => {
      const penalty = p.hand.reduce((a, t) => a + tilePoints(t), 0);
      p.score = -penalty;
      return s + penalty;
    }, 0);
    this.winner.score = penaltySum;
    this.log.push(`Игра окончена. Победил ${this.winner.name}!`);
  }

  /** Досрочное завершение игры (хост). Без победителя и без начисления очков. */
  endEarly() {
    if (this.phase !== 'playing') return;
    this.phase = 'ended';
    this.winner = null;
    for (const p of this.players) {
      p.score = 0;
    }
    this.log.push('Игра завершена досрочно. Очки не начисляются, победитель не определяется.');
  }

  /** Взять фишку из колоды. Возвращает { ok, error?, tile? } */
  draw(playerId) {
    if (this.phase !== 'playing') return { ok: false, error: 'Игра уже окончена' };
    if (!this.isCurrent(playerId)) return { ok: false, error: 'Сейчас не ваш ход' };
    if (this.turnDrew) return { ok: false, error: 'Вы уже взяли фишку в этом ходу' };

    let tile;
    if (this.stock.length === 0) {
      if (this.discard.length > 0) {
        this.stock = shuffle(this.discard.splice(0));
        this.log.push('Колода закончилась, сброс перемешан заново.');
      } else {
        return { ok: false, error: 'Колода пуста' };
      }
    }
    tile = this.stock.pop();
    const who = this.currentPlayer().name;
    this.getPlayer(playerId).hand.push(tile);
    this.turnDrew = true;
    this.log.push(`${who} взял фишку из колоды.`);
    this.advanceTurn();
    return { ok: true, tile };
  }

  /**
   * Сыграть: применить итоговую расстановку стола.
   * @param playerId
   * @param board массив групп фишек (итоговое состояние стола)
   */
  play(playerId, board) {
    if (this.phase !== 'playing') return { ok: false, error: 'Игра уже окончена' };
    if (!this.isCurrent(playerId)) return { ok: false, error: 'Сейчас не ваш ход' };
    if (this.turnDrew) return { ok: false, error: 'В этом ходу вы уже взяли фишку' };
    if (!Array.isArray(board) || board.some((m) => !Array.isArray(m))) {
      return { ok: false, error: 'Неверные данные хода' };
    }

    const player = this.getPlayer(playerId);
    const oldIds = this.board.flat().map((t) => t.id);
    const oldSet = new Set(oldIds);
    const newIds = board.flat().map((t) => t.id);
    const newSet = new Set(newIds);

    // Никаких дублей фишек на столе
    if (newSet.size !== newIds.length) return { ok: false, error: 'Фишки не могут быть в двух местах' };

    const handIds = new Set(player.hand.map((t) => t.id));

    // Все старые фишки стола должны остаться
    for (const id of oldIds) {
      if (!newSet.has(id)) return { ok: false, error: 'Нельзя убирать фишки со стола' };
    }
    // Новые фишки должны быть из руки игрока, и их должно быть минимум одна
    const deltaIds = [...newSet].filter((id) => !oldSet.has(id));
    if (deltaIds.length === 0) return { ok: false, error: 'Нужно выложить хотя бы одну фишку с руки' };
    for (const id of deltaIds) {
      if (!handIds.has(id)) return { ok: false, error: 'Обнаружены недопустимые фишки' };
    }

    // Каждая группа должна быть корректной
    for (const meld of board) {
      if (!isValidMeld(meld)) return { ok: false, error: 'На столе есть некорректная группа' };
    }

    // Первая выкладка должна набрать минимум 30 очков (только новыми фишками с руки)
    if (!player.melded) {
      const deltaTiles = board.flat().filter((t) => !oldSet.has(t.id));
      const sum = deltaTiles.reduce((s, t) => s + tilePoints(t), 0);
      if (sum < 30) {
        return { ok: false, error: `Первая выкладка должна набирать минимум 30 очков (сейчас ${sum})` };
      }
    }

    const deltaSet = new Set(deltaIds);
    player.hand = player.hand.filter((t) => !deltaSet.has(t.id));
    player.melded = true;
    this.board = board;
    this.log.push(`${player.name} выложил фишки на стол.`);

    if (player.hand.length === 0) {
      this.winner = player;
      this.finish();
    } else {
      this.advanceTurn();
      this.log.push(`Ходит ${this.currentPlayer().name}.`);
    }
    return { ok: true };
  }
}
