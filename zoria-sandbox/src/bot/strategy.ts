/**
 * СТРАТЕГІЯ живого бота.
 *
 * Два принципи, обидва з анонсу турніру:
 *
 * 1. ЖОДНОГО ХАРДКОДУ ПРАВИЛ ГРИ. Все рахується від `cfg`, який прийшов
 *    від движка. Коли організатори зроблять «зсув констант» — цей файл
 *    не треба чіпати.
 *
 * 2. ВАГИ ВИНЕСЕНІ В ОБ'ЄКТ. Вони не «придумані», а підібрані на арені
 *    (src/tune.ts). Перша, «очевидно розумна» версія цієї стратегії
 *    давала 30% вінрейту проти тупого бота — дізнатись про це можна
 *    було ТІЛЬКИ вимірюванням.
 */

import type { Action, GameConfig, GameState, Vec } from '../engine/game.ts';

const dist = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export type Weights = {
  /** штраф за ресурс, до якого суперник дійде раніше (він його забере) */
  lossPenalty: number;
  /** штраф за ресурс, куди прийдемо одночасно (за правилами він ЗГОРИТЬ) */
  tiePenalty: number;
  /** тяга до центру поля: звідти коротше до наступного спавну */
  centerPull: number;
};

export const TUNED: Weights = { lossPenalty: 10, tiePenalty: 0, centerPull: 0.15 };

const dirTo = (me: Vec, t: Vec): Action => {
  const dx = t.x - me.x, dy = t.y - me.y;
  if (dx === 0 && dy === 0) return { type: 'STAY' };
  if (Math.abs(dx) >= Math.abs(dy)) return { type: 'MOVE', dir: dx > 0 ? 'E' : 'W' };
  return { type: 'MOVE', dir: dy > 0 ? 'S' : 'N' };
};

export function makeGreedy(w: Weights) {
  return (state: GameState, cfg: GameConfig, myId: string): Action => {
    const me = state.players.find((p) => p.id === myId)!;
    const enemy = state.players.find((p) => p.id !== myId)!;
    if (state.resources.length === 0) return { type: 'STAY' };

    const cx = (cfg.width - 1) / 2, cy = (cfg.height - 1) / 2;
    let best: Vec | null = null;
    let bestScore = -Infinity;

    for (const r of state.resources) {
      const mine = dist(me, r);
      const theirs = dist(enemy, r);

      // База: кожен хід коштує тік, тому ближче = краще.
      let score = -mine;

      // Ресурс, до якого суперник дійде раніше, — це витрачені ходи даремно.
      if (theirs < mine) score -= w.lossPenalty;
      // Прийти одночасно ще гірше: за правилами движка ресурс згорить в обох.
      if (theirs === mine) score -= w.tiePenalty;

      score -= (Math.abs(r.x - cx) + Math.abs(r.y - cy)) * w.centerPull;

      if (score > bestScore) { bestScore = score; best = r; }
    }

    return best ? dirTo(me, best) : { type: 'STAY' };
  };
}

/** Наш бот із підібраними вагами. */
export const greedy = makeGreedy(TUNED);

/** Базовий бот організаторів: тупо біжить у найближчий ресурс. */
export function naive(state: GameState, _cfg: GameConfig, myId: string): Action {
  const me = state.players.find((p) => p.id === myId)!;
  const r = state.resources.reduce<Vec | null>(
    (b, it) => (!b || dist(me, it) < dist(me, b) ? it : b), null);
  return r ? dirTo(me, r) : { type: 'STAY' };
}
