// Tiny bot for "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana".
//
// Two sleeves, one purse. The trend sleeve rides an hourly uptrend and sits
// in USDC while it falls: per symbol it tracks an EMA(4) against an EMA(26)
// of hourly closes, buys when the fast EMA pulls 0.20% above the slow one,
// and sells everything when it drops 0.40% below. The dip sleeve buys sharp
// slides that already bounce: a close 1.75% under where it was 3 bars ago,
// on a bar that closed up, sold at +1.75%, cut at -1.00%, or out after 8 bars
// whatever comes first. Positions are sized equally across everything the bot
// wants, never more than 25% of equity in one symbol (the harness cap), and
// the bot only trades when a signal flips, so fees do not eat the edge.
// No clock, no randomness, no network, no outside data: the same bars always
// give the same orders.
import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const FAST = 4; // bars in the fast EMA
const SLOW = 26; // bars in the slow EMA
const ENTER_GAP_BPS = 20; // buy once fast EMA beats slow EMA by 0.20%
const EXIT_GAP_BPS = -40; // sell once fast EMA trails slow EMA by 0.40%
const DIP_BPS = 175; // dip sleeve: 1.75% slide over 3 bars, then a green bar
const TAKE_BPS = 175; // dip sleeve: take profit at +1.75% from the fill
const CUT_BPS = 100; // dip sleeve: cut the loss at -1.00% from the fill
const MAX_HOLD_BARS = 8; // dip sleeve: out after 8 bars at the latest
const TARGET_INVEST_BPS = 9000; // aim to invest at most 90% of equity
const MAX_SLIPPAGE_BPS = 100;
const MAX_IMPACT_BPS = 100; // shrink a buy while its pool impact tops this

type Mode = 'trend' | 'mr';

interface Track {
  closes: number[]; // closes in USDC per unit, as floats (signals only)
  emaFast: number;
  emaSlow: number;
  mode: Mode | null; // how the current position was opened, if any
  entryPrice: number; // fill price of the current position, USDC per unit
  entryBar: number; // seq of the bar the current position filled on
}

const tracks = new Map<string, Track>();

function emaAlpha(n: number): number {
  return 2 / (n + 1);
}

function closeOf(state: BarsState, symbol: string): number {
  const bar = state.latest.get(symbol)!;
  return Number(bar.c) / 10 ** (state.symbols.get(symbol)?.price_scale ?? 0);
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  // First, learn what filled: a buy's fill price and bar start its dip clock.
  for (const fill of batch.fills) {
    if (fill.status !== 'filled') {
      // A buy that never filled opened no position: drop the mode its
      // decision left behind, so no later position inherits a stale sleeve.
      // (A rejected sell leaves the position held, so its mode stays.)
      if (fill.side === 'buy') {
        const t = tracks.get(fill.symbol);
        if (t !== undefined) t.mode = null;
      }
      continue;
    }
    const t = tracks.get(fill.symbol);
    if (t === undefined) continue;
    if (fill.side === 'buy') {
      t.entryPrice = Number(fill.price) / 10 ** (state.symbols.get(fill.symbol)?.price_scale ?? 0);
      t.entryBar = state.seq;
    } else {
      t.mode = null;
    }
  }
  // Fold this bar's closes into every symbol's trend track.
  for (const symbol of state.latest.keys()) {
    const close = closeOf(state, symbol);
    let t = tracks.get(symbol);
    if (t === undefined) {
      t = { closes: [], emaFast: close, emaSlow: close, mode: null, entryPrice: 0, entryBar: -1 };
      tracks.set(symbol, t);
    }
    t.closes.push(close);
    if (t.closes.length > 512) t.closes.shift(); // bound memory; history gate needs 26
    t.emaFast += emaAlpha(FAST) * (close - t.emaFast);
    t.emaSlow += emaAlpha(SLOW) * (close - t.emaSlow);
  }
  // Warm-up bars exist to build history from: their closes are folded above,
  // but no order is ever decided on one (the harness rejects it as warmup).
  if (state.warmingUp) return [];

  // Decide: which symbols do we want to hold after this bar?
  const want = new Set<string>();
  for (const [symbol, t] of tracks) {
    const held = state.positions.has(symbol);
    const close = t.closes[t.closes.length - 1]!;
    if (held) {
      if (t.mode === 'mr') {
        // Dip sleeve exit: take the bounce, cut the slide, or time out.
        if (close * 10_000 >= t.entryPrice * (10_000 + TAKE_BPS)) continue;
        if (close * 10_000 <= t.entryPrice * (10_000 - CUT_BPS)) continue;
        if (state.seq - t.entryBar >= MAX_HOLD_BARS) continue;
        want.add(symbol);
      } else {
        if (t.closes.length < SLOW) continue;
        const gapBps = ((t.emaFast - t.emaSlow) / t.emaSlow) * 10_000;
        if (gapBps < EXIT_GAP_BPS) continue; // trend broke: sell
        want.add(symbol);
      }
    } else {
      // Trend entry first: a real uptrend beats a dip.
      if (t.closes.length >= SLOW) {
        const gapBps = ((t.emaFast - t.emaSlow) / t.emaSlow) * 10_000;
        if (gapBps > ENTER_GAP_BPS) {
          want.add(symbol);
          t.mode = 'trend';
          continue;
        }
      }
      // Dip entry: a sharp 3-bar slide, then a green bar (bounce starting).
      if (t.closes.length >= 4) {
        const slid = close < t.closes[t.closes.length - 4]! * (10_000 - DIP_BPS) / 10_000;
        const bounced = close > t.closes[t.closes.length - 2]!;
        if (slid && bounced) {
          want.add(symbol);
          t.mode = 'mr';
        }
      }
    }
  }

  const orders: OrderInput[] = [];
  // Exits first: sell every held symbol we no longer want, in full.
  for (const [symbol, held] of state.positions) {
    if (!want.has(symbol)) {
      orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
    }
  }
  // Entries: split the investable equity equally across everything we want.
  const entries = [...want].filter((s) => !state.positions.has(s));
  if (entries.length > 0) {
    const perSymbol = (state.equity * BigInt(TARGET_INVEST_BPS)) / 10_000n / BigInt(want.size);
    // Buys in one reply share the cash on hand: each buy spends only what
    // the earlier buys of this reply left, so their sum never tops the cash
    // and a later buy is not rejected for cash an earlier one already took.
    let cashLeft = state.cash;
    for (const symbol of entries) {
      const room = state.weightRoom(symbol); // harness cap: 25% of equity
      let notional = perSymbol < room ? perSymbol : room;
      if (notional > cashLeft) notional = cashLeft;
      // Shrink while the trade would move its own pool too much.
      for (let i = 0; i < 3; i++) {
        const impact = state.impactBps(symbol, notional);
        if (impact === null || impact <= BigInt(MAX_IMPACT_BPS)) break;
        notional /= 2n;
      }
      const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
      if (notional >= minNotional && notional > 0n) {
        const t = tracks.get(symbol)!;
        const prefix = t.mode === 'mr' ? 'm' : 't';
        orders.push({
          side: 'buy',
          symbol,
          notional_quote_units: notional,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
          client_id: `${prefix}-${symbol}-${state.seq}`,
        });
        cashLeft -= notional;
      }
    }
  }
  return orders;
}

await runBars({ onBatch });
