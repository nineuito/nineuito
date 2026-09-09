/**
 * НАКАЗ — декларативний автопілот.
 *
 * ЧОМУ ЦЕ YAML, А НЕ КОД — головне питання, і відповідь така:
 * Наказ виконується на СЕРВЕРІ організаторів, коли твій бот мовчить
 * (відвалився інтернет / не встиг у дедлайн). Запускати чужий
 * довільний JS у себе на судді ніхто не буде — це діра в безпеці.
 * Тому тобі дають закритий словник умов і дій, а ти складаєш із них
 * пріоритезований список правил.
 *
 * Наслідок для тебе: Наказ обмежений за виразністю, і єдиний спосіб
 * зробити його сильним — це правильний ПОРЯДОК правил.
 * Перше правило, чия умова справдилась, виграє. Решта не дивиться.
 */

import type { Action, GameConfig, GameState, Player, Vec } from './game.ts';

export type Condition =
  | 'always'
  | { enemyWithin: number }
  | { resourceWithin: number }
  | { tickAfter: number }
  | { losing: true };

export type Behaviour = 'seekResource' | 'flee' | 'chaseEnemy' | 'seekCenter' | 'hold';

export type Rule = { when: Condition; do: Behaviour };
export type Order = { name: string; rules: Rule[] };

/** Манхеттенська відстань — саме нею рухаються фігури на сітці. */
const dist = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const nearest = <T extends Vec>(from: Vec, items: T[]): T | null =>
  items.reduce<T | null>((best, it) =>
    !best || dist(from, it) < dist(from, best) ? it : best, null);

/** Крок у бік цілі (або від неї, якщо away=true). */
function stepToward(me: Player, target: Vec | null, away = false): Action {
  if (!target) return { type: 'STAY' };
  let dx = target.x - me.x;
  let dy = target.y - me.y;
  if (away) { dx = -dx; dy = -dy; }
  if (dx === 0 && dy === 0) return { type: 'STAY' };
  // йдемо спершу по довшій осі — так шлях коротший за манхеттеном
  if (Math.abs(dx) >= Math.abs(dy)) return { type: 'MOVE', dir: dx > 0 ? 'E' : 'W' };
  return { type: 'MOVE', dir: dy > 0 ? 'S' : 'N' };
}

function test(c: Condition, me: Player, enemy: Player | null, s: GameState): boolean {
  if (c === 'always') return true;
  if ('enemyWithin' in c) return !!enemy && dist(me, enemy) <= c.enemyWithin;
  if ('resourceWithin' in c) {
    const r = nearest(me, s.resources);
    return !!r && dist(me, r) <= c.resourceWithin;
  }
  if ('tickAfter' in c) return s.tick >= c.tickAfter;
  if ('losing' in c) return !!enemy && me.score < enemy.score;
  return false;
}

function run(b: Behaviour, me: Player, enemy: Player | null, s: GameState, cfg: GameConfig): Action {
  switch (b) {
    case 'seekResource': return stepToward(me, nearest(me, s.resources));
    case 'chaseEnemy':   return stepToward(me, enemy);
    case 'flee':         return stepToward(me, enemy, true);
    case 'seekCenter':   return stepToward(me, { x: (cfg.width / 2) | 0, y: (cfg.height / 2) | 0 });
    case 'hold':         return { type: 'STAY' };
  }
}

/** Виконати Наказ: перше правило, що спрацювало, визначає дію. */
export function evalOrder(
  order: Order,
  playerId: string,
  s: GameState,
  cfg: GameConfig,
): { action: Action; ruleIndex: number } {
  const me = s.players.find((p) => p.id === playerId)!;
  const enemy = s.players.find((p) => p.id !== playerId) ?? null;

  for (let i = 0; i < order.rules.length; i++) {
    const r = order.rules[i];
    if (test(r.when, me, enemy, s)) {
      return { action: run(r.do, me, enemy, s, cfg), ruleIndex: i };
    }
  }
  // жодне правило не підійшло — стоїмо. У турнірі це найгірший результат:
  // порожній Наказ = злитий тиждень 1, бо там грають ТІЛЬКИ накази.
  return { action: { type: 'STAY' }, ruleIndex: -1 };
}
