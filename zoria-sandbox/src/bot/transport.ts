/**
 * ТРАНСПОРТНИЙ ШАР.
 *
 * Це те, що в анонсі названо «проектує свій транспортний шар зв'язку»,
 * і те, на чому в таких турнірах сиплеться більшість учасників.
 * Стратегія тут не при чому — це чиста інженерія надійності:
 *
 *   1. підключитись і привітатись (HELLO -> WELCOME)
 *   2. тримати зв'язок живим (PING/PONG)
 *   3. перепідключитись після обриву — з бекофом і джитером
 *   4. ПРОДОВЖИТИ матч (RESUME), а не почати новий
 *   5. ніколи не проґавити дедлайн тіку
 */

import WebSocket from 'ws';
import type { Action, GameConfig, GameState } from '../engine/game.ts';

export type Decide = (state: GameState, cfg: GameConfig, myId: string) => Action;

export type BotOptions = {
  url: string;
  name: string;
  order: unknown;              // Наказ їде на сервер і живе там
  decide: Decide;
  /** Для демо: вбити зв'язок на тіку `atTick` і лежати `forMs` мілісекунд. */
  drop?: { atTick: number; forMs: number };
  log?: (line: string) => void;
};

export function runBot(opts: BotOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  let ws: WebSocket | null = null;
  let myId = '';
  let config: GameConfig | null = null;
  let resumeToken: string | null = null;
  let attempt = 0;
  let finished = false;
  let lastTick = -1;
  let outageMs = 0;

  return new Promise((resolveDone) => {
    const connect = () => {
      if (finished) return;
      ws = new WebSocket(opts.url);

      ws.on('open', () => {
        attempt = 0;                       // успішне підключення скидає бекоф
        if (resumeToken) {
          // ВАЖЛИВО: після обриву — RESUME, а не HELLO.
          // HELLO почав би новий матч і викинув би весь набраний рахунок.
          ws!.send(JSON.stringify({ t: 'RESUME', token: resumeToken }));
          log(`[${opts.name}] перепідключився, RESUME`);
        } else {
          ws!.send(JSON.stringify({ t: 'HELLO', name: opts.name, order: opts.order }));
        }
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));

        if (msg.t === 'WELCOME') {
          if (msg.resumed) log(`[${opts.name}] зв'язок відновлено, продовжую матч (RESUME)`);
          myId = msg.playerId;
          config = msg.config;             // константи беремо ЗВІДСИ, не з хардкоду
          resumeToken = msg.resumeToken;
          if (!msg.resumed) log(`[${opts.name}] у грі як ${myId}`);
          return;
        }

        if (msg.t === 'PING') return ws!.send(JSON.stringify({ t: 'PONG', id: msg.id }));

        if (msg.t === 'TICK') {
          lastTick = msg.tick;

          // Демо-обрив: імітуємо, що в нас пропав інтернет.
          if (opts.drop && msg.tick === opts.drop.atTick) {
            outageMs = opts.drop.forMs;
            log(`[${opts.name}] !! зв'язок обірвано на тіку ${msg.tick} — керування бере Наказ`);
            ws!.terminate();
            return;
          }

          // ДЕДЛАЙН-ГАРД. Рішення має бути відправлене ЗАВЖДИ.
          // Посередній хід вчасно кращий за ідеальний після дедлайну:
          // після дедлайну твій хід просто ігнорується, і грає Наказ.
          const budget = (config?.tickDeadlineMs ?? 80) * 0.6;
          const t0 = performance.now();
          let action: Action;
          try {
            action = opts.decide(msg.state, config!, myId);
          } catch (e) {
            action = { type: 'STAY' };     // краще стояти, ніж впасти
          }
          const spent = performance.now() - t0;
          if (spent > budget) log(`[${opts.name}] ⚠ тік ${msg.tick}: ${spent.toFixed(1)}ms з ${budget.toFixed(0)}ms`);

          ws!.send(JSON.stringify({ t: 'ACTION', tick: msg.tick, action }));
          return;
        }

        if (msg.t === 'RESULT') {
          finished = true;
          log(`[${opts.name}] матч завершено: ${JSON.stringify(msg.scores)}`);
          ws!.close();
          resolveDone();
        }
      });

      ws.on('close', () => {
        if (finished) return;

        // Запобіжник: сервер міг зникнути назовсім. Без ліміту спроб
        // бот висів би в реконекті вічно й ніколи не завершив процес.
        if (attempt > 12) {
          log(`[${opts.name}] сервер недоступний, здаюсь після ${attempt} спроб`);
          finished = true;
          return resolveDone();
        }

        // РЕКОНЕКТ: експоненційний бекоф + джитер.
        // Джитер потрібен, щоб після падіння сервера всі клієнти
        // не гатили в нього одночасно однією хвилею.
        let wait = Math.min(2000, 100 * 2 ** attempt) + Math.random() * 100;
        if (outageMs > 0) { wait = outageMs; outageMs = 0; }   // демо-обрив
        attempt++;
        setTimeout(connect, wait);
      });

      ws.on('error', () => { /* close спрацює слідом і запустить реконект */ });
    };

    connect();
  });
}
