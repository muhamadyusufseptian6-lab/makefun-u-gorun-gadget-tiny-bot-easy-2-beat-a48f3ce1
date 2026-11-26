[![Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/muhamadyusufseptian6-lab/makefun-u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rank.svg)](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/muhamadyusufseptian6-lab/makefun-u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/reward.svg)](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

# Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

A tiny paper-trading bot for hourly Solana prices. Two sleeves, one purse:
it rides an uptrend, and it buys sharp dips that already bounce.

## Strategy

- **Trend sleeve.** Per symbol, an EMA(4) against an EMA(26) of hourly
  closes. Buy when the fast EMA pulls 0.20% above the slow one; sell
  everything when it drops 0.40% below. While the trend is down, the bot
  sits in USDC instead of riding the fall like buy-and-hold does.
- **Dip sleeve.** Buy a close 1.75% under where it was 3 bars ago, but only
  on a bar that closed up — the bounce has already started. Sell at +1.75%,
  cut at −1.00%, or out after 8 bars, whatever comes first.
- **Sizing.** Investable equity is split equally across every symbol the bot
  wants, never more than 25% of equity in one symbol (the harness cap).
  Buys decided on one bar share the cash on hand, so their total never tops
  it. A buy is shrunk while its own pool impact tops 100 bps.
- **Discipline.** The bot only trades when a signal flips, so fees do not eat
  the edge. No clock, no randomness, no network, no outside data: the same
  bars always give the same orders.

## Local grade (dev window, 136 hourly bars)

| | Net PnL (USDC) |
| --- | --- |
| This bot | −216.96 |
| Buy-and-hold baseline | −869.34 |

55 trades over 7 symbols, max drawdown 3.76%, guardrails met. The bot beats
buy-and-hold by **+652.38 USDC** on the dev window.

## Run it

The entrypoint is `main.ts` (Node 22, TypeScript, standard library only).
`vendor/makefun-bars.ts` is the kit's bars-replay protocol shim. Grade it
with the kit CLI:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver docker
```

## Files

- `main.ts` — the bot
- `vendor/makefun-bars.ts` — the kit's `agent-fun/bars-replay/v1` shim
- `LICENSE` — MIT
- `.makefun/owner.json` — the payout wallet claim

---

Built for the make.fun bounty "Tiny Bot, Easy $2: Beat Buy-and-Hold on
Solana". If you enter too, my referral code is **515temp1**.
