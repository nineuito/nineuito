/**
 * ДВИЖОК ГРИ («суддя»).
 *
 * Тут НЕМА мережі. Це чиста функція: стан + дії гравців -> новий стан.
 * У справжньому турнірі це і є `@contest/engine`, і саме цей файл
 * треба читати замість регламенту: правила = код.
 */

export type Dir = 'N' | 'S' | 'E' | 'W';

/** Що бот може відправити за один тік. */
export type Action =
  | { type: 'MOVE'; dir: Dir }
  | { type: 'STAY' };

export type Vec = { x: number; y: number };

export type Player = {
  id: string;
  x: number;
  y: number;
  score: number;
};

export type GameState = {
  tick: number;
  players: Player[];
  resources: Vec[];
};

/**
 * КОНСТАНТИ ГРИ.
 * Саме їх організатори «зсувають» посеред сезону.
 * Тому бот НІКОЛИ не має хардкодити ці числа — він отримує config
 * на старті матчу і рахує все від нього.
 */
export type GameConfig = {
  width: number;
  height: number;
  totalTicks: number;
  resourceValue: number;
  spawnEvery: number;      // кожні N тіків з'являється новий ресурс
  maxResources: number;    // більше цього на полі не буває
  tickDeadlineMs: number;  // скільки в бота є на відповідь
  minTickMs: number;       // мінімальна тривалість тіку (фіксований темп сервера)
};

export const DEFAULT_CONFIG: GameConfig = {
  width: 11,
  height: 11,
  totalTicks: 80,
  resourceValue: 1,
  spawnEvery: 2,
  maxResources: 6,
  tickDeadlineMs: 80,
  minTickMs: 10,
};

/**
 * Детермінований генератор випадкових чисел (mulberry32).
 * Math.random() тут використовувати НЕ можна: з однаковим сідом
 * матч має відтворюватись байт-у-байт, інакше неможливо
 * ні дебажити реплеї, ні чесно порівнювати дві версії бота.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DELTA: Record<Dir, Vec> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
  E: { x: 1, y: 0 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createGame(cfg: GameConfig, seed: number, ids: string[]): GameState {
  const rng = makeRng(seed);
  const state: GameState = {
    tick: 0,
    players: ids.map((id, i) => ({
      id,
      // гравці стартують у протилежних кутах — симетрично, без переваги
      x: i === 0 ? 1 : cfg.width - 2,
      y: i === 0 ? 1 : cfg.height - 2,
      score: 0,
    })),
    resources: [],
  };
  for (let i = 0; i < 3; i++) spawnResource(state, cfg, rng);
  return state;
}

function spawnResource(state: GameState, cfg: GameConfig, rng: () => number): void {
  if (state.resources.length >= cfg.maxResources) return;
  // 30 спроб знайти вільну клітинку; якщо не вийшло — просто пропускаємо тік
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rng() * cfg.width);
    const y = Math.floor(rng() * cfg.height);
    const busy =
      state.resources.some((r) => r.x === x && r.y === y) ||
      state.players.some((p) => p.x === x && p.y === y);
    if (!busy) {
      state.resources.push({ x, y });
      return;
    }
  }
}

export type TickEvent =
  | { kind: 'COLLECT'; playerId: string; at: Vec }
  | { kind: 'CONTESTED'; at: Vec; playerIds: string[] };

/**
 * ОДИН ТІК ГРИ.
 *
 * Порядок резолву — найважливіше, що є в правилах, і саме те,
 * що більшість учасників не читає:
 *   1. усі рухи застосовуються ОДНОЧАСНО (не по черзі!)
 *   2. вихід за межі поля не помилка — координата просто затискається
 *   3. збір: якщо на ресурсі рівно один гравець — він забирає;
 *      якщо двоє — ресурс ЗГОРАЄ, не отримує ніхто
 *   4. спавн нового ресурсу
 *
 * Пункт 3 — це «tie-break». Через такі правила виграються матчі:
 * жадібний бот завжди біжить у найближчий ресурс, і його легко
 * підманити на нічию, забравши очко деінде.
 */
export function step(
  state: GameState,
  cfg: GameConfig,
  actions: Record<string, Action>,
  rng: () => number,
): { state: GameState; events: TickEvent[] } {
  const next: GameState = structuredClone(state);
  const events: TickEvent[] = [];

  // 1-2. рух (одночасний) + затискання до меж
  for (const p of next.players) {
    const a = actions[p.id] ?? { type: 'STAY' };
    if (a.type === 'MOVE') {
      const d = DELTA[a.dir];
      p.x = clamp(p.x + d.x, 0, cfg.width - 1);
      p.y = clamp(p.y + d.y, 0, cfg.height - 1);
    }
  }

  // 3. збір ресурсів
  next.resources = next.resources.filter((r) => {
    const on = next.players.filter((p) => p.x === r.x && p.y === r.y);
    if (on.length === 0) return true;            // ресурс лишається
    if (on.length === 1) {
      on[0].score += cfg.resourceValue;
      events.push({ kind: 'COLLECT', playerId: on[0].id, at: { x: r.x, y: r.y } });
    } else {
      events.push({ kind: 'CONTESTED', at: { x: r.x, y: r.y }, playerIds: on.map((p) => p.id) });
    }
    return false;                                 // ресурс зникає в обох випадках
  });

  // 4. спавн
  next.tick = state.tick + 1;
  if (next.tick % cfg.spawnEvery === 0) spawnResource(next, cfg, rng);

  return { state: next, events };
}

export const isOver = (s: GameState, cfg: GameConfig) => s.tick >= cfg.totalTicks;

export function winner(s: GameState): string | null {
  const [a, b] = [...s.players].sort((p, q) => q.score - p.score);
  if (!b || a.score === b.score) return null; // нічия
  return a.id;
}
