# Alesia — Quantitative Research Engine

A multi-timeframe trade-setup engine and a leak-safe walk-forward backtester, built as a layer on top of the open-source [`virattt/alesia`](https://github.com/virattt/alesia) research agent.

![tests](https://img.shields.io/badge/tests-570%20passing-brightgreen)
![typecheck](https://img.shields.io/badge/tsc%20--noEmit-clean-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict%20ESM-3178C6)
![Bun](https://img.shields.io/badge/Bun-1.3-black)

> **The headline result is negative, and it leads on purpose.** Across six hypotheses and ~18,600 backtested trades, no configuration produced a robust out-of-sample edge. The engine ships saying so — in the tool payload itself, not in a footnote.
>
> That is the point of this repository. Anyone can produce a backtest that looks profitable. The work here is the machinery that makes a *flattering* result hard to produce by accident, and the discipline to publish what it returned.

---

## Attribution — what is mine and what is not

This matters more than a badge, so it goes first.

| Layer | Author | What it is |
|---|---|---|
| Agent core — CLI, agent loop, planning, memory, evals, WhatsApp gateway, provider plumbing | [virattt/alesia](https://github.com/virattt/alesia) (MIT) | The host application. Not my work. |
| **Quantitative research engine** — indicators, market read, horizons, trade setup, thresholds, calibration, backtest harness, six research studies | **Nobody Ohm** ([@nobodyohm-web](https://github.com/nobodyohm-web)) | 52 files and 10,604 lines under `src/tools/finance/` (8,018 source + 2,586 test), of which 268 tests. Plus the integration into the host registry. |

`git shortlog -sn` will confirm the split in five seconds, so there is no reason to blur it. Everything this README claims as a result belongs to the second row.

---

## The engine in one paragraph

Given a symbol and a horizon (`day`, `swing`, `medium`, `long`), the engine reads three timeframes — bias from the higher, structure from the middle, trigger from the lower — classifies the regime, selects a strategy, places an entry zone, a stop and targets in **R-multiples**, scores its confidence, and then attaches the *measured* historical expectancy of that exact setup type. If the measurement says no edge was demonstrated, the payload says so in words the model cannot round up into a recommendation.

```
Horizon      Trend TF   Structure   Entry TF   Stop        Min R:R
day          1h         15m         5m         0.75 ATR    1.5
swing        1d         4h          1h         1.0  ATR    2.0
medium       1wk        1d          1d         1.5  ATR    2.5
long         1wk        1wk         1d         2.5  ATR    3.0
```

### Modules

| File | Responsibility |
|---|---|
| `indicators.ts` | ~30 pure, series-aligned indicators — RSI, MACD, ADX, ATR, Keltner/Bollinger squeeze, MFI, OBV, VWAP, divergences, pivots, Donchian, Fibonacci |
| `candles.ts` | Unified OHLCV across equities and crypto; session-aware aggregation |
| `market-read.ts` | Regime classification: `trending` / `ranging` / `compressed` / `volatile-expansion` |
| `horizons.ts` | Per-horizon doctrine, stop sizing, holding limits, R:R floors |
| `trade-setup.ts` | Strategy selection, level construction, confidence scoring |
| `thresholds.ts` | Every magic number in one injectable object — so it can be swept |
| `calibration.ts` | The measured truth attached to every recommendation |
| `backtest/` | Walk-forward harness + the six studies below |

---

## What was measured

Every figure below is net of costs unless marked gross, produced by the harness in `src/tools/finance/backtest/`, and reproducible with the commands in each row.

| # | Hypothesis | Verdict | Result |
|---|---|---|---|
| 1 | Threshold calibration will find a profitable configuration | **Null** | Crypto swing **+0.006R**, CI95 `[-0.033, +0.046]`, n=3,821. A full sweep found *no* parameter value with positive out-of-sample expectancy: train `+0.05…+0.075R`, test `-0.08…-0.10R`. Not a tuning problem. |
| 2 | The day horizon is tradeable | **Disproven, precisely** | Gross **+0.0257R**, CI95 `[0.005, 0.048]` — statistically real. But cost sensitivity is exactly linear (`cost_R = 193.6 × costFraction`), so it breaks even at **1.33bp** round trip versus ~8bp at the cheapest realistic fee. Net −0.129R at 8bp, −0.362R at 20bp. The signal exists and is ~6× too small to pay for the trip. |
| 3 | Extreme funding predicts reversals | **Null** | 24 threshold cells tested, 1 cleared — against **1.2 expected by chance alone**. Direction was inverted (crowded longs kept winning) and train/test flips sign. |
| 4a | Implied volatility forecasts better than ATR | **Confirmed** | IV corr **+0.670 / +0.681** vs ATR +0.601 / +0.627, out-of-sample, reproduced on a second index. |
| 4b | IV rank predicts direction | **Null** | Three bins looked significant on overlapping windows; **all** collapsed after thinning to non-overlapping ones. |
| 5 | So: size the stop by IV instead of ATR | **No** | Pooled **−0.025R**, CI95 `[-0.251, +0.213]` across 5 asset/index pairings. A better forecast of X does not improve a decision that only weakly depends on X — the stop sits beyond *structure*, with volatility as a buffer, then capped. |
| 6 | Cross-venue OI aggregation beats Binance alone | **Not testable** | Binance caps OI history at exactly 30 days (verified; `startTime` older returns error −1130). 199 overlapping hours available; **565 needed** to resolve a 0.5pp edge. Not "unproven" — *not testable*. |

**Result 4 is the one to read closely.** Hypothesis 4a was confirmed and looked directly actionable — and hypothesis 5, the obvious way to cash it in, still failed. A true premise does not guarantee a profitable conclusion.

### Where the negatives came from

Four of these six would have been "discoveries" if I had stopped one step earlier:

- **Funding** — testing the bin mean against *zero* gave 2 significant cells. Testing the **excess over the baseline**, which is the actual hypothesis, left 1 — below the chance rate.
- **IV rank** — significant on overlapping forward windows, gone after thinning to independent ones.
- **IV stops** — SPY and QQQ alone pooled to **+0.149R** and read as a finding. Adding gold, oil and the Dow flipped it to **−0.025R**.
- **Cross-venue OI** — the motivating claim (34 flags, 29.4% unconfirmed) did not replicate on a different window (5 flags, 6.0%). It was an observation about one month, not a measurement.

---

## The harness

`src/tools/finance/backtest/harness.ts` is the part I would most want read.

- **Leak-safe by construction.** Every decision is taken on a fixed-size `windowAt()` slice. Never backward indexing, never a full-series indicator precomputed then read at index *i*. Guarded by a test that appends 300 future bars and asserts **no past decision changes**.
- **Look-ahead hazards are documented per indicator.** `supportResistance` uses end-of-series ATR tolerance and `swingPoints` needs right-side bars, so neither may be precomputed. MACD is strictly causal, so it may.
- **Bar-by-bar fill scanning.** An earlier version stepped over bars and manufactured a spurious **+0.26R**. Step-independence is now a test.
- **Gap-through guard.** Fills beyond the zone or through the stop are rejected, not booked. That bug alone was worth **−1.26R** on the affected trades.
- **Two-sample bootstrap on the difference against the baseline** — never against zero — with a deterministic LCG so results reproduce exactly.
- **Multiple comparisons are counted and printed**: cells tested × 0.05 = expected false positives, stated next to the finding.
- **Survivorship bias stated as a direction, not a disclaimer.** Yahoo serves only instruments that still trade, so equity results are **ceilings**. Binance klines from 2017 carry none, which is why the crypto sample is treated as the reliable one.

### Guards that were proven to fail before being trusted

A guard that has never gone red is decoration. Each of these was demonstrated failing first:

| Guard | Demonstration |
|---|---|
| Calibration drift (`calibration.test.ts`) | Nudging `adxSetupTrending` 22 → 26 makes it fail — stale numbers cannot ship silently |
| Reachability (`reachability.test.ts`) | Reintroducing the dead reversal branch produces 2 failures |
| Leak safety (`harness.test.ts`) | 300 appended future bars change no past decision |

### Bugs worth naming

- **Wilder smoothing.** RSI/ATR/ADX use α = 1/period, *not* the EMA's 2/(n+1). The classic silent error.
- **Flat plateaus registered as both swing high and swing low** — fixed with strict inequality on one side.
- **Extended-hours contamination.** Yahoo returned a 4h Donchian low of 177.09 against a true 190.02 → `includePrePost: false`.
- **A negative price target** (BTC long T2 at −36,183) → per-horizon stop caps.
- **Funding interval hardcoded at 8h** while 126 of 208 perps settle every 4h → inferred from timestamp medians.
- **Two dead branches** in strategy selection that could never fire, one of which demanded a long bias in an oversold market — conditions that exclude each other by construction. A backtest found the condition true **0 times in 3,011 bars**.

---

## Verify it yourself in two minutes

```bash
bun install
bun test                 # 570 pass, 0 fail
bun run typecheck        # clean, strict ESM
```

Then reproduce any claim above:

```bash
bun run src/tools/finance/backtest/run.ts baseline    # table 1 and 2
bun run src/tools/finance/backtest/funding-study.ts   # 3
bun run src/tools/finance/backtest/iv-study.ts        # 4a and 4b
bun run src/tools/finance/backtest/iv-stop-study.ts   # 5
bun run src/tools/finance/backtest/oi-study.ts        # 6
```

Each study prints its own method notes, its multiple-comparison count, and its verdict. `oi-collector.ts` is an hourly append-only collector for the one series that cannot be bought retroactively at any price a hobbyist would pay — cross-venue open interest only exists going forward.

---

## Running the agent

The host application is virattt's; its setup is unchanged.

```bash
cp env.example .env      # add ANTHROPIC_API_KEY / OPENAI_API_KEY, etc.
bun start                # interactive
bun dev                  # watch mode
```

The engine registers as tools (`trade_setup`, `technical_analysis`, …) inside the agent's registry, so it is reachable from a natural-language question as well as directly from the backtest scripts.

### Desktop launchers

```bash
./launchers/build.sh macos      # Alesia.app — drag onto the Dock
./launchers/build.sh windows    # Alesia.exe — pin to the taskbar
```

On Windows, `launchers/Alesia.cmd` is committed and needs no build at all. Alesia is a terminal UI, so every launcher opens a terminal rather than hiding one. See [launchers/README.md](launchers/README.md) — including why a Dock-launched app cannot find a Bun installed in `~/.bun/bin`, which is the failure these are built around.

---

## What this repository is good for

It is **not** a profitable trading system, and it says so in its own output. What it demonstrates:

- Building a non-trivial quantitative system in strict TypeScript, tested to 268 dedicated assertions
- Designing a backtest whose failure modes are known, documented and guarded rather than hoped away
- Statistical judgment under the incentive to find something — baseline-relative tests, window thinning, multiple-comparison accounting, out-of-sample splits
- Reporting a negative result clearly, when a slightly less careful version of each test would have produced a positive one

If a system says it found an edge, the interesting question is what it would have taken for it to say otherwise. Here, that machinery is the deliverable.

---

## License

MIT. Originally authored by [Virat Singh](https://github.com/virattt) (`virattt/alesia`); the quantitative research engine under `src/tools/finance/` is © 2026 Nobody Ohm. See [LICENSE](LICENSE).
