---
name: portfolio-review
description: Analyzes a portfolio of multiple tickers with quick scores and allocation suggestions. Triggers when user types "portfolio", "portefeuille", or provides a comma-separated list of tickers like "FLY,AAPL,BTC".
---

# Portfolio Review & Allocation

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→4) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Si plus de 8 tickers sont fournis, prends les 8 premiers et signale la troncature en une ligne. Pour CHAQUE ticker, le score doit être justifié (chain-of-thought). Langue : FRANÇAIS.**

When the user provides multiple tickers, run a quick analysis on each and generate a portfolio summary with allocation suggestions and concentration alerts.

## Steps

1. **Parse** the ticker list (comma- or space-separated). Cap at 8.
2. **Classify each ticker** before fetching data:
   - Crypto symbols (BTC, ETH, SOL, ADA, DOT, AVAX, MATIC, LINK, XRP, DOGE, BNB, etc.) → use Binance
   - Everything else → treat as stock and use Yahoo
3. **Fetch in parallel** (one call per ticker):
   - Stock: `yahoo_summary` ticker=[TICKER]
   - Crypto: `binance_price` symbol=[TICKER]USDT  +  `binance_klines` symbol=[TICKER]USDT, interval='1d', limit=60
4. **Score** and **classify maturity** per asset (see grids below). Aggregate concentration risk across the portfolio (sector / asset class / single-name weight).

## Maturity & Type Tags

- 🚀 Speculative — pre-profit stock OR memecoin
- 📈 Growth — profitable stock with revenue growth >15% OR top-50 crypto by market cap
- 🏛️ Mature — stable profitable stock OR BTC/ETH
- 🪙 Crypto — generic tag for any crypto when finer detection isn't possible

## Quick Score (0-10 per asset, with chain-of-thought)

For each asset, compute and **justify each point**:

### Stocks
- **Profitable + Growing** (+3) — `netIncome > 0` AND `revenueGrowth > 8%`
- **Low debt** (+2) — `debtToEquity < 1` (use `keyStatistics.debtToEquity`)
- **Positive momentum** (+2) — current price > `twoHundredDayAverage`
- **Reasonable valuation** (+2) — `trailingPE < 25` OR `pegRatio < 1.5`
- **Positive FCF** (+1) — `freeCashflow > 0`

### Crypto
- **Top-10 market cap** (+3) — symbol in {BTC, ETH, BNB, SOL, XRP, USDT, USDC, ADA, DOGE, AVAX, TRX, LINK, DOT}
- **Above 50-day MA** (+2) — current price > MA50 from `binance_klines` (compute mean of last 50 closes)
- **Volume rising** (+2) — last-7-day average volume > prior-7-day average volume
- **Reasonable drawdown from ATH** (+2) — within 50% of 60-day high
- **Positive 24h change** (+1) — `priceChangePercent24h > 0`

## Output (French)

```
╔═══════════════════════════════════════════════════╗
║          📂 REVUE DE PORTEFEUILLE                  ║
║          Date : [today]                            ║
║          Actifs analysés : N                       ║
╚═══════════════════════════════════════════════════╝

┌──────────┬───────┬──────────┬───────┬──────────────────┐
│ Ticker   │ Prix  │ Score    │ Type  │ Signal           │
├──────────┼───────┼──────────┼───────┼──────────────────┤
│ AAPL     │ $XXX  │ 8/10 ⭐⭐⭐⭐ │ 🏛️    │ 🟢 Solide        │
│ FLY      │ $XX   │ 5/10 ⭐⭐⭐  │ 🚀    │ 🟡 Spéculatif    │
│ BTC      │ $XXXK │ 7/10 ⭐⭐⭐⭐ │ 🪙    │ 🟢 Momentum      │
└──────────┴───────┴──────────┴───────┴──────────────────┘

🔍 JUSTIFICATIONS DES SCORES
- AAPL : 8/10 — profitable + growing (+3), low debt (+2), above 200d MA (+2), reasonable PEG (+1)
- FLY : 5/10 — pré-profit, marges en amélioration (+2), momentum positif (+2), valorisation raisonnable (+1)
- BTC : 7/10 — top-10 (+3), above 50d MA (+2), volume rising (+2)

💡 ALLOCATION SUGGÉRÉE (basée sur la composition actuelle)
   🏛️ Mature (fond de portefeuille) : 50-60%
   📈 Croissance : 20-30%
   🚀 Spéculatif : 10-15%
   🪙 Crypto : 5-10%

⚠️ ALERTES PORTEFEUILLE
- Concentration sectorielle si > 40% sur un seul secteur → flag 🔴
- Allocation spéculative si > 25% en 🚀+memecoins → flag 🔴
- Earnings imminents (<14j) sur un holding → flag 🟡 + nom du ticker
- Drawdown moyen du portefeuille vs S&P 500 sur 1 an (utilise `yahoo_historical` ^GSPC period='1y' si nécessaire)

📌 ACTIONS RECOMMANDÉES
[3 puces concrètes : trim/hold/add. Mentionne Trade Republic 🇪🇺 quand pertinent.]

⚠️ Recherche automatisée, pas un conseil en investissement.
```
