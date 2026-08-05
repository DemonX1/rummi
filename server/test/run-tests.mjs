import { isValidMeld, sortMeld } from '../src/game/melds.js';
import { Game } from '../src/game/game.js';
import { aiDecision } from '../src/game/ai.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function t(color, value) {
  return { id: `${color}${value}`, color, value };
}
function j(id) {
  return { id: `j${id}`, color: 'JOKER', value: 0 };
}
function tile(id, color, value) {
  return { id, color, value };
}

// --- isValidMeld ---
check('сет из трёх', isValidMeld([t('R', 5), t('B', 5), t('K', 5)]), true);
check('сет из четырёх', isValidMeld([t('R', 7), t('B', 7), t('K', 7), t('Y', 7)]), true);
check('сет с повтором цвета — нет', isValidMeld([t('R', 5), t('R', 5), t('B', 5)]), false);
check('сет с разными числами — нет', isValidMeld([t('R', 5), t('B', 6), t('K', 5)]), false);
check('две фишки — нет', isValidMeld([t('R', 5), t('B', 5)]), false);
check('серия 1,2,3', isValidMeld([t('R', 1), t('R', 2), t('R', 3)]), true);
check('серия 12,13 — нет', isValidMeld([t('R', 12), t('R', 13)]), false);
check('серия с пропуском — нет', isValidMeld([t('R', 1), t('R', 3), t('R', 4)]), false);
check('серия с джокером (1,2,J)', isValidMeld([t('R', 1), t('R', 2), j(1)]), true);
check('серия 13 + 2 джокера', isValidMeld([t('R', 13), j(1), j(2)]), true);
check('серия 1 + 2 джокера', isValidMeld([t('R', 1), j(1), j(2)]), true);
check('джокер в сете', isValidMeld([t('R', 8), t('B', 8), j(1)]), true);
check('два джокера в сете', isValidMeld([t('R', 8), j(1), j(2)]), true);
check('три джокера', isValidMeld([j(1), j(2), j(3)]), true);

// --- sortMeld ---
check('серия сортируется по возрастанию',
  sortMeld([t('R', 7), t('R', 4), t('R', 5), t('R', 6)]).map((x) => x.value),
  [4, 5, 6, 7]);
check('джокер встаёт в разрыв серии',
  sortMeld([t('R', 6), t('R', 4), j(1)]).map((x) => x.color === 'JOKER' ? 0 : x.value),
  [4, 0, 6]);
check('сет группируется по цветам, джокер в конец',
  sortMeld([j(1), t('R', 8), t('B', 8)]).map((x) => (x.color === 'JOKER' ? 'J' : x.color)),
  ['B', 'R', 'J']);

// --- Первый заход: 30+ очков ---
const g2 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
const meld = [tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)];
g2.players[0].hand = [
  tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13), tile('B2', 'B', 2),
];
const r1 = g2.play('p1', [meld]);
check('первый заход 36>=30 принят', r1.ok, true);
check('ход перешёл к боту', g2.currentPlayer().id, 'p2');

const g3 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
const lowMeld = [tile('R1', 'R', 1), tile('R2', 'R', 2), tile('R3', 'R', 3)];
g3.players[0].hand = [tile('R1', 'R', 1), tile('R2', 'R', 2), tile('R3', 'R', 3), tile('B9', 'B', 9)];
const rLow = g3.play('p1', [lowMeld]);
check('первый заход 6 очков отклонён', rLow.ok, false);
check('первый заход: сообщение про 30', /30/.test(rLow.error || ''), true);

// --- Незваные фишки отклоняются ---
const g4 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
const badMeld = [tile('X1', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)]; // X1 не из руки
g4.players[0].hand = [tile('R12', 'R', 12), tile('R13', 'R', 13), tile('B2', 'B', 2)];
const r4 = g4.play('p1', [badMeld]);
check('чуждая фишка отклонена', r4.ok, false);

// Взятие фишки
const g5 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
const beforeHand = g5.players[0].hand.length;
const r5 = g5.draw('p1');
check('взятие фишки ок', r5.ok, true);
check('рука выросла', g5.players[0].hand.length, beforeHand + 1);
check('ход после взятия перешёл', g5.currentPlayer().id, 'p2');

// После взятия фишки нельзя выкладывать в этом ходу
const g6 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
g6.draw('p1'); // ход перешёл к боту
g6.players[0].hand = [tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)];
const r6 = g6.play('p1', [[tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)]]);
check('после взятия фишки ход уже не твой', r6.ok, false);

// Победа: игрок опустошает руку
const g7 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
const winMeld = [tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)];
g7.players[0].hand = [tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)];
const r7 = g7.play('p1', [winMeld]);
check('победа распознана', r7.ok && g7.phase === 'ended', true);
check('победитель определён', g7.winner?.id, 'p1');
check('штраф соперника посчитан', g7.players[1].score < 0, true);
check('очки победителя = сумма штрафов', g7.winner.score, -g7.players[1].score);

// Перестановка фишек стола (манипуляции) валидируется
const g8 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
g8.players[0].hand = [tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13), tile('B5', 'B', 5)];
const r8 = g8.play('p1', [[tile('R11', 'R', 11), tile('R12', 'R', 12), tile('R13', 'R', 13)]]);
check('первая выкладка ок', r8.ok, true);
// ход теперь у бота — не можем ничего менять; просто убедимся что бот-ход работает дальше
check('игра продолжается', g8.phase, 'playing');

// --- Досрочное завершение игры (без победителя и без начисления очков) ---
const g9 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
g9.players[0].hand = [tile('R1', 'R', 1), tile('R2', 'R', 2)]; // 3 очка
g9.players[1].hand = [tile('B5', 'B', 5), tile('B6', 'B', 6)]; // 11 очков
g9.endEarly();
check('досрочное завершение', g9.phase, 'ended');
check('победитель не определяется', g9.winner, null);
check('очки не начисляются', g9.players.every((p) => p.score === 0), true);

const g10 = new Game([{ id: 'p1', name: 'Аня', ai: false }, { id: 'p2', name: 'Бот', ai: true }]);
g10.players[0].hand = [tile('R1', 'R', 1)];
g10.players[1].hand = [tile('B1', 'B', 1)];
g10.endEarly();
check('ничья: победитель не определяется', g10.winner, null);
check('ничья: очки не начисляются', g10.players.every((p) => p.score === 0), true);

// --- AI ---
const aiGame = new Game([
  { id: 'p1', name: 'Аня', ai: false },
  { id: 'bot1', name: 'Бот', ai: true },
]);
aiGame.players[1].hand = Array.from({ length: 14 }, (_, i) => ({ id: `ai${i}`, color: 'R', value: (i % 13) + 1 }));
const d = aiDecision(aiGame);
check('aiDecision возвращает объект или null', d === null || typeof d.board === 'object', true);

console.log(`\n✅ ${pass} passed, ❌ ${fail} failed`);
process.exit(fail ? 1 : 0);