/**
 * ЛОКАЛЬНА АРЕНА.
 *
 * Найважливіший інструмент турніру, і його треба зробити РАНІШЕ за стратегію.
 * Мережі тут нема взагалі — движок викликається напряму, тому тисяча
 * матчів проганяється за секунди.
 *
 * Причина існування: один матч нічого не доводить. Гра випадкова,
 * і будь-який бот виграє окремий матч. Порівнювати версії можна
 * тільки за вінрейтом на сотнях сідів — і обов'язково з дзеркалом
 * (кожен сід грається двічі, зі зміною сторін), інакше ти міряєш
 * не стратегію, а перевагу стартової позиції.
 *
 *   node --experimental-strip-types src/arena.ts --games 400
 */

import { createGame, step, isOver, makeRng, DEFAULT_CONFIG, type Action, type GameConfig } from './engine/game.ts';
import { greedy, naive } from './bot/strategy.ts';

type Decide = (s: any, c: GameConfig, id: string) => Action;

function play(a: Decide, b: Decide, cfg: GameConfig, seed: number): number {
  let state = createGame(cfg, seed, ['p1', 'p2']);
  const rng = makeRng(seed ^ 0x9e3779b9);
  while (!isOver(state, cfg)) {
    state = step(state, cfg, {
      p1: a(state, cfg, 'p1'),
      p2: b(state, cfg, 'p2'),
    }, rng).state;
  }
  const [p1, p2] = state.players;
  return Math.sign(p1.score - p2.score); // 1 = виграв A, -1 = виграв B, 0 = нічия
}

/** Похибка вінрейту (95%). Без неї «55% проти 52%» — це просто шум. */
const ci95 = (p: number, n: number) => 1.96 * Math.sqrt((p * (1 - p)) / n);

export function compare(a: Decide, b: Decide, cfg: GameConfig, games: number) {
  let w = 0, d = 0, l = 0;

  // ДЗЕРКАЛО. Кожен сід грається ДВІЧІ — один і той самий світ,
  // але зі зміною сторін. Це прибирає перевагу стартової позиції.
  //
  // Тут легко помилитись так, що потім півсезону робиш хибні висновки:
  // якщо для однієї сторони брати парні сіди, а для іншої непарні,
  // це вже НЕ дзеркало — це два різні набори світів. У такій «арені»
  // навіть бот проти самого себе показує 48.8% замість рівних 50%,
  // і ти починаєш «покращувати» те, що насправді просто шум.
  for (let seed = 0; seed < Math.ceil(games / 2); seed++) {
    for (const r of [play(a, b, cfg, seed), -play(b, a, cfg, seed)]) {
      r > 0 ? w++ : r < 0 ? l++ : d++;
    }
  }
  const n = w + d + l;
  const wr = (w + d / 2) / n;
  return { w, d, l, wr, ci: ci95(wr, n) };
}

if (import.meta.filename === process.argv[1]) {
  const gi = process.argv.indexOf('--games');
  const games = gi >= 0 ? Number(process.argv[gi + 1]) : 400;

  console.log(`Арена: greedy vs naive, ${games} матчів (з дзеркалом)\n`);

  const shifts = [1, 1.5, 0.5];
  for (const shift of shifts) {
    const cfg: GameConfig = {
      ...DEFAULT_CONFIG,
      spawnEvery: Math.max(1, Math.round(DEFAULT_CONFIG.spawnEvery * shift)),
      maxResources: Math.max(1, Math.round(DEFAULT_CONFIG.maxResources / shift)),
    };
    const t0 = performance.now();
    const r = compare(greedy, naive, cfg, games);
    const ms = performance.now() - t0;
    const label = shift === 1 ? 'базові константи' : `зсув констант ×${shift}`;
    console.log(
      `${label.padEnd(22)} вінрейт ${(r.wr * 100).toFixed(1)}% ± ${(r.ci * 100).toFixed(1)}` +
      `   (В ${r.w} / Н ${r.d} / П ${r.l})   ${ms.toFixed(0)}ms`,
    );
  }
  console.log('\nЯкщо інтервал ± перекриває 50% — різниці нема, це шум.');
}
