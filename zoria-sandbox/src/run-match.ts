/**
 * ЗАПУСК МАТЧУ.
 *   node --experimental-strip-types src/run-match.ts --seed 7 --drop 25:38
 *
 * Піднімає сервер-суддю, підключає двох ботів по справжньому WebSocket
 * і зберігає реплей у replay.json для в'ювера.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { startMatchServer, type Replay } from './engine/server.ts';
import { DEFAULT_CONFIG, type GameConfig } from './engine/game.ts';
import { runBot } from './bot/transport.ts';
import { greedy, naive } from './bot/strategy.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const seed = Number(arg('seed') ?? 7);
const dropArg = arg('drop')?.split(':').map(Number);
const drop = dropArg ? { atTick: dropArg[0], forMs: dropArg[1] } : undefined;
const port = 8787 + (seed % 100);

// «Зсув констант»: --shift множить балансні параметри.
// Спробуй --shift 1.5 і подивись, чи не розвалилась твоя стратегія.
const shift = Number(arg('shift') ?? 1);
const config: GameConfig = {
  ...DEFAULT_CONFIG,
  spawnEvery: Math.max(1, Math.round(DEFAULT_CONFIG.spawnEvery * shift)),
  maxResources: Math.max(1, Math.round(DEFAULT_CONFIG.maxResources / shift)),
};

const orders = {
  cautious: parse(readFileSync(new URL('./bot/orders/cautious.yaml', import.meta.url), 'utf8')),
  greedy: parse(readFileSync(new URL('./bot/orders/greedy.yaml', import.meta.url), 'utf8')),
};

const log = (l: string) => console.log(l);

const done = new Promise<Replay>((resolve) => {
  startMatchServer({
    port, seed, config,
    onFinish: (replay) => {
      writeFileSync(new URL('../replay.json', import.meta.url), JSON.stringify(replay, null, 2));
      resolve(replay);
    },
  });
});

const url = `ws://127.0.0.1:${port}`;

await Promise.all([
  // Наш бот: розумна стратегія + сильний Наказ на випадок обриву
  runBot({ url, name: 'ТИ', order: orders.cautious, decide: greedy, drop, log }),
  // Базовий бот організаторів: жадібний, з примітивним Наказом
  runBot({ url, name: 'БАЗОВИЙ', order: orders.greedy, decide: naive, log }),
]);

const replay = await done;

console.log('\n─────────────── РЕЗУЛЬТАТ ───────────────');
for (const s of replay.seats) {
  const st = replay.stats[s.id];
  console.log(
    `${s.name.padEnd(9)} рахунок ${String(replay.result.scores[s.id]).padStart(2)}` +
    `   живих тіків ${String(st.liveTicks).padStart(3)}` +
    `   під Наказом ${String(st.orderTicks).padStart(3)}  («${s.order}»)`,
  );
}
const w = replay.result.winner;
console.log(`\nПереможець: ${w ? replay.seats.find((s) => s.id === w)!.name : 'нічия'}`);
console.log(`Реплей: zoria-sandbox/replay.json (${replay.frames.length} кадрів)`);
