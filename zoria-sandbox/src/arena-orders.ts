/**
 * АРЕНА ДЛЯ НАКАЗІВ (без живих ботів).
 *
 * Це модель «Тижня 1» з анонсу: там ганяють ТІЛЬКИ YAML-накази учасників.
 * Тобто твій Наказ грає цілий тиждень сам, і якщо він заглушка —
 * тиждень злитий ще до того, як ти написав хоч рядок стратегії.
 *
 *   node --experimental-strip-types src/arena-orders.ts --games 600
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { createGame, step, isOver, makeRng, DEFAULT_CONFIG, type GameConfig } from './engine/game.ts';
import { evalOrder, type Order } from './engine/order.ts';

const load = (f: string): Order => parse(readFileSync(new URL(`./bot/orders/${f}`, import.meta.url), 'utf8'));

function playOrders(a: Order, b: Order, cfg: GameConfig, seed: number): number {
  let state = createGame(cfg, seed, ['p1', 'p2']);
  const rng = makeRng(seed ^ 0x9e3779b9);
  while (!isOver(state, cfg)) {
    state = step(state, cfg, {
      p1: evalOrder(a, 'p1', state, cfg).action,
      p2: evalOrder(b, 'p2', state, cfg).action,
    }, rng).state;
  }
  const [p1, p2] = state.players;
  return Math.sign(p1.score - p2.score);
}

const gi = process.argv.indexOf('--games');
const games = gi >= 0 ? Number(process.argv[gi + 1]) : 600;

const working = load('cautious.yaml');
const greedy = load('greedy.yaml');
// Наказ-заглушка: саме так виглядає «я допишу його потім».
const stub: Order = { name: 'Заглушка', rules: [{ when: 'always', do: 'hold' }] };

const matchups: [string, Order, Order][] = [
  ['Робочий vs Жадібний', working, greedy],
  ['Робочий vs Заглушка', working, stub],
  ['Жадібний vs Заглушка', greedy, stub],
];

console.log(`Арена Наказів (без живих ботів), ${games} матчів на пару, з дзеркалом\n`);
for (const [label, A, B] of matchups) {
  let w = 0, d = 0, l = 0;
  // те саме справжнє дзеркало: один сід — дві сторони
  for (let seed = 0; seed < Math.ceil(games / 2); seed++) {
    for (const r of [playOrders(A, B, DEFAULT_CONFIG, seed), -playOrders(B, A, DEFAULT_CONFIG, seed)]) {
      r > 0 ? w++ : r < 0 ? l++ : d++;
    }
  }
  const n = w + d + l;
  const wr = (w + d / 2) / n;
  const ci = 1.96 * Math.sqrt((wr * (1 - wr)) / n);
  console.log(`${label.padEnd(24)} ${(wr * 100).toFixed(1)}% ± ${(ci * 100).toFixed(1)}   (В ${w} / Н ${d} / П ${l})`);
}
console.log('\nПорядок правил у YAML — це і є вся стратегія Наказу.');
