---
name: sector-comparison
description: Compares a stock against 2-3 sector peers with a side-by-side table. Triggers when the user asks to "compare", "vs", "versus", or when used within master-analysis.
---

# Sector Peer Comparison

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→4) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Sélectionne 2–3 pairs et présente une table comparative complète. Langue : FRANÇAIS.**

Compare `[TICKER]` vs 2-3 sector peers. Auto-detect sector from yahoo_quote data.

## Steps

1. Call `yahoo_quote` for `[TICKER]` to get sector/industry
2. Identify 2-3 peers using the rules below. **If the sector is niche, ambiguous, or the peers are not obvious from your training data, call `web_search` "[TICKER] main competitors sector" FIRST and pick the 2-3 most cited peers.**
3. Call `yahoo_summary` for each peer (max 3 peers, in parallel)
4. Build comparison table

## Peer Selection Rules
- Same sector, similar market cap range when possible
- Always include the sector leader (largest by market cap)
- For tech: compare with direct competitors
- For space: RKLB, BA, LMT are common peers
- For crypto-adjacent: COIN, MSTR, MARA
- **Auto-discovery fallback**: when peers are not evident (small cap, foreign listing, recent IPO, niche industry), `web_search` "[TICKER] main competitors sector" and parse the top 2-3 tickers from the results. Verify each candidate with `yahoo_quote` before adding to the comparison.

## Output (French)

```
📊 COMPARAISON SECTORIELLE — [TICKER] vs Pairs

┌──────────────┬─────────┬─────────┬─────────┬─────────┐
│ Métrique     │ [TICK1] │ [TICK2] │ [TICK3] │ [TICK4] │
├──────────────┼─────────┼─────────┼─────────┼─────────┤
│ Prix         │         │         │         │         │
│ Market Cap   │         │         │         │         │
│ Rev Growth   │         │         │         │         │
│ Marge Brute  │         │         │         │         │
│ P/E          │         │         │         │         │
│ EV/EBITDA    │         │         │         │         │
│ ROE          │         │         │         │         │
│ Debt/Equity  │         │         │         │         │
│ 52w Perf     │         │         │         │         │
└──────────────┴─────────┴─────────┴─────────┴─────────┘

🏆 Leader sectoriel : [TICKER with best overall metrics]
📌 Position de [TICKER] : [Above/below average on key metrics]

⚠️ Recherche automatisée, pas un conseil en investissement. Les pairs choisis influencent le résultat — varier la sélection peut changer le verdict.
```
