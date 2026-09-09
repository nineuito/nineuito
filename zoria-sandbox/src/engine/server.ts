/**
 * СЕРВЕР-СУДДЯ.
 *
 * Тримає матч, ганяє тіки, чекає на дії ботів і — ключове —
 * перехоплює керування Наказом, якщо бот не відповів у дедлайн
 * (впав інтернет, залип івент-луп, бот просто думав занадто довго).
 *
 * Протокол (те, що в анонсі назвали «транспортним шаром»):
 *
 *   бот -> сервер    сервер -> бот
 *   ─────────────    ──────────────
 *   HELLO            WELCOME  { playerId, resumeToken, config }
 *   RESUME           TICK     { tick, state, deadlineMs }
 *   ACTION           RESULT   { scores, winner }
 *   PONG             PING
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  createGame, step, isOver, winner, makeRng,
  type Action, type GameConfig, type GameState,
} from './game.ts';
import { evalOrder, type Order } from './order.ts';

type Seat = {
  id: string;
  name: string;
  order: Order;
  ws: WebSocket | null;          // null == зв'язок обірвано, грає Наказ
  resumeToken: string;
  pending: { tick: number; resolve: (a: ActionSource) => void } | null;
  liveTicks: number;
  orderTicks: number;
};

type ActionSource = { action: Action; source: 'live' | 'order'; rule?: number };

export type Frame = {
  tick: number;
  players: { id: string; x: number; y: number; score: number }[];
  resources: { x: number; y: number }[];
  control: Record<string, 'live' | 'order'>;
  note?: string;
};

export type Replay = {
  seed: number;
  config: GameConfig;
  seats: { id: string; name: string; order: string }[];
  frames: Frame[];
  result: { scores: Record<string, number>; winner: string | null };
  stats: Record<string, { liveTicks: number; orderTicks: number }>;
};

const send = (ws: WebSocket | null, msg: unknown) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

export function startMatchServer(opts: {
  port: number;
  seed: number;
  config: GameConfig;
  onFinish: (r: Replay) => void;
}): { close: () => void } {
  const { port, seed, config } = opts;
  const wss = new WebSocketServer({ port });
  const seats: Seat[] = [];
  const frames: Frame[] = [];
  let started = false;
  // Результат зберігаємо: бот, що перепідключився вже після кінця матчу,
  // мусить його отримати, інакше він вічно висітиме в реконекті.
  let finalResult: unknown = null;

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { 
        // Протокольна помилка. У турнірі саме на цьому валиться
        // «Перша присяга» — матч без протокольних помилок.
        return send(ws, { t: 'ERROR', code: 'BAD_JSON' });
      }

      if (msg.t === 'HELLO') {
        if (started) return send(ws, { t: 'ERROR', code: 'MATCH_STARTED' });
        const seat: Seat = {
          id: `p${seats.length + 1}`,
          name: msg.name ?? `player${seats.length + 1}`,
          order: msg.order,
          ws,
          resumeToken: `tok-${seats.length + 1}-${seed}`,
          pending: null,
          liveTicks: 0,
          orderTicks: 0,
        };
        seats.push(seat);
        (ws as any)._seatId = seat.id;
        send(ws, {
          t: 'WELCOME',
          playerId: seat.id,
          resumeToken: seat.resumeToken,
          // КОНСТАНТИ ЇДУТЬ ДО БОТА ТУТ. Не хардкодь їх у себе —
          // організатори змінять їх посеред сезону («зсув констант»).
          config,
        });
        if (seats.length === 2) { started = true; void runMatch(); }
        return;
      }

      if (msg.t === 'RESUME') {
        // Перепідключення ПРОДОВЖУЄ матч, а не починає новий.
        // Без resumeToken бот після обриву грав би з нуля — і зливав.
        const seat = seats.find((s) => s.resumeToken === msg.token);
        if (!seat) return send(ws, { t: 'ERROR', code: 'BAD_TOKEN' });
        seat.ws = ws;
        (ws as any)._seatId = seat.id;
        send(ws, { t: 'WELCOME', playerId: seat.id, resumeToken: seat.resumeToken, config, resumed: true });
        // Матч уже скінчився, поки бот перепідключався — віддаємо результат одразу.
        if (finalResult) send(ws, finalResult);
        return;
      }

      if (msg.t === 'ACTION') {
        const seat = seats.find((s) => s.id === (ws as any)._seatId);
        if (!seat?.pending) return;
        // Дія за не той тік — ігноруємо. Це захист від «запізнілої»
        // відповіді, що прилетіла після дедлайну попереднього тіку.
        if (msg.tick !== seat.pending.tick) return;
        const p = seat.pending;
        seat.pending = null;
        p.resolve({ action: msg.action, source: 'live' });
      }
    });

    ws.on('close', () => {
      const seat = seats.find((s) => s.id === (ws as any)._seatId);
      if (seat && seat.ws === ws) seat.ws = null;   // матч триває, керує Наказ
    });
  });

  /** Чекаємо на дію бота, але не довше дедлайну. */
  function awaitAction(seat: Seat, state: GameState): Promise<ActionSource> {
    return new Promise((resolve) => {
      const fallback = () => {
        const { action, ruleIndex } = evalOrder(seat.order, seat.id, state, config);
        resolve({ action, source: 'order', rule: ruleIndex });
      };
      if (!seat.ws || seat.ws.readyState !== 1) return fallback();  // зв'язку нема — одразу Наказ

      const mine = { tick: state.tick, resolve };
      seat.pending = mine;
      send(seat.ws, { t: 'TICK', tick: state.tick, state, deadlineMs: config.tickDeadlineMs });

      // ОБЕРЕЖНО З ТАЙМЕРАМИ ДЕДЛАЙНУ.
      // Тут була помилка, на яку легко натрапити: таймер тіку N спрацьовував
      // уже під час тіку N+8 і гасив `seat.pending`, який належав ЧУЖОМУ тіку.
      // Той тік після цього не міг завершитись ніколи — матч намертво вставав.
      // Тому таймер зобов'язаний перевіряти, що гасить саме СВІЙ запит.
      setTimeout(() => {
        if (seat.pending !== mine) return;   // цей запит уже закрито — не чіпаємо чужий
        seat.pending = null;
        fallback();
      }, config.tickDeadlineMs);
    });
  }

  async function runMatch() {
    let state = createGame(config, seed, seats.map((s) => s.id));
    const rng = makeRng(seed ^ 0x9e3779b9);

    while (!isOver(state, config)) {
      const tickStart = Date.now();
      const results = await Promise.all(seats.map((s) => awaitAction(s, state)));

      const actions: Record<string, Action> = {};
      const control: Record<string, 'live' | 'order'> = {};
      seats.forEach((s, i) => {
        actions[s.id] = results[i].action;
        control[s.id] = results[i].source;
        results[i].source === 'live' ? s.liveTicks++ : s.orderTicks++;
      });

      frames.push({
        tick: state.tick,
        players: state.players.map((p) => ({ ...p })),
        resources: state.resources.map((r) => ({ ...r })),
        control,
      });

      state = step(state, config, actions, rng).state;

      // Сервер тримає фіксований темп. Без цього тіки під Наказом
      // пролітали б за мілісекунди, і обрив зв'язку на 3 секунди
      // з'їдав би весь матч замість кількох ходів.
      const left = config.minTickMs - (Date.now() - tickStart);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    }

    const scores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
    finalResult = { t: 'RESULT', scores, winner: winner(state) };
    for (const s of seats) send(s.ws, finalResult);

    opts.onFinish({
      seed,
      config,
      seats: seats.map((s) => ({ id: s.id, name: s.name, order: s.order.name })),
      frames,
      result: { scores, winner: winner(state) },
      stats: Object.fromEntries(seats.map((s) => [s.id, { liveTicks: s.liveTicks, orderTicks: s.orderTicks }])),
    });
    // Пільговий час: даємо тим, хто ще в реконекті, встигнути забрати RESULT.
    setTimeout(() => wss.close(), 1500);
  }

  return { close: () => wss.close() };
}
