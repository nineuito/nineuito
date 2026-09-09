/**
 * ПІДБІР ВАГ НА АРЕНІ.
 *
 * Це і є щоденна робота в турнірі: не «придумати розумну евристику»,
 * а перебрати варіанти і залишити той, що виграє вимірювано.
 *
 *   node --experimental-strip-types src/tune.ts
 */

import { DEFAULT_CONFIG, type GameConfig } from './engine/game.ts';
import { makeGreedy, naive, type Weights } from './bot/strategy.ts';
import { compare } from './arena.ts';

const GAMES = 600;
const cfg: GameConfig = DEFAULT_CONFIG;

const grid: Weights[] = [];
for (const lossPenalty of [0, 2, 5, 10, 20])
  for (const tiePenalty of [0, 2, 5, 10, 20])
    for (const centerPull of [0, 0.15, 0.4])
      grid.push({ lossPenalty, tiePenalty, centerPull });

console.log(`Перебір ${grid.length} комбінацій × ${GAMES} матчів...\n`);

const rows = grid.map((w) => ({ w, r: compare(makeGreedy(w), naive, cfg, GAMES) }));
rows.sort((a, b) => b.r.wr - a.r.wr);

console.log('топ-8:');
for (const { w, r } of rows.slice(0, 8)) {
  console.log(
    `  loss ${String(w.lossPenalty).padStart(2)}  tie ${String(w.tiePenalty).padStart(2)}` +
    `  center ${String(w.centerPull).padEnd(4)}  ->  ${(r.wr * 100).toFixed(1)}% ± ${(r.ci * 100).toFixed(1)}`,
  );
}
console.log('\nнайгірші 3 (щоб було видно ціну поганих ваг):');
for (const { w, r } of rows.slice(-3)) {
  console.log(`  loss ${String(w.lossPenalty).padStart(2)}  tie ${String(w.tiePenalty).padStart(2)}  center ${String(w.centerPull).padEnd(4)}  ->  ${(r.wr * 100).toFixed(1)}%`);
}
