---
name: dividend-analysis
description: Deep-dive into dividend history, payout ratio, growth rate, and yield comparison for mature companies. Triggers when user asks about "dividende", "dividend", "rendement", or "yield" for a specific ticker.
---

# Dividend Analysis — Income Investor Focus

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→4) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Si la société ne verse pas de dividende, dis-le clairement en une phrase et stoppe — NE produis PAS un rapport vide. Langue : FRANÇAIS.**

For mature, dividend-paying companies. Not applicable to startups or pre-profit companies.

## Steps

1. Call `yahoo_summary` for `[TICKER]`. Extract: `dividendYield`, `dividendRate`, `payoutRatio`,
   `exDividendDate`, `freeCashflow`, `marketCap`. **If `dividendRate ≤ 0` or absent → company
   is non-dividend-paying. Reply in 1 sentence "[TICKER] ne verse pas de dividende — analyse
   non applicable. Pour une analyse fondamentale, tape simplement [TICKER]." and STOP.**
2. Call `analyst_consensus` for `[TICKER]` to enrich the verdict (target prices for total-return
   estimate including dividends).
3. Call `yahoo_historical` for `[TICKER]` with `period='5y', interval='1mo'` to detect
   dividend-paying months and compute the 5-year dividend CAGR.
4. Call `web_search "[TICKER] consecutive years of dividend increases dividend aristocrat"`
   to confirm aristocrat / king status when the metric is unavailable from Yahoo.

## Key Metrics to Calculate
- **Dividend Yield** = Annual Dividend / Price
- **Payout Ratio** = Dividends / Net Income (>80% = danger, <50% = safe)
- **Dividend Growth Rate** = CAGR of dividends over 5 years
- **Years of Consecutive Increases** (Dividend Aristocrat = 25+)
- **FCF Coverage** = FCF / Total Dividends Paid (>1.5 = safe)

## Output (French)

```
💰 ANALYSE DIVIDENDES — [COMPANY] ([TICKER])

┌────────────────────────────┬──────────────┐
│ Rendement actuel           │ X.XX%        │
│ Dividende annuel/action    │ $X.XX        │
│ Ratio de distribution      │ XX%          │
│ Couverture FCF             │ X.Xx         │
│ Croissance 5 ans (CAGR)    │ XX%          │
│ Années consécutives        │ XX ans       │
│ Prochaine date ex-div      │ [DATE]       │
└────────────────────────────┴──────────────┘

Sécurité du dividende :
[Payout < 50% AND FCF coverage > 2]: 🟢 TRÈS SÛR — Dividende fortress
[Payout 50-70% AND FCF coverage > 1.2]: 🟢 SÛR — Bien couvert
[Payout 70-85%]: 🟡 ATTENTION — Marge de manœuvre limitée
[Payout > 85% OR FCF < dividends]: 🔴 DANGER — Risque de coupe

💡 Si tu achètes 100 actions à $XXX ($XX,XXX total):
   → Tu reçois ~$XXX/an de dividendes ($XX/trimestre)
   → Yield on Cost dans 5 ans (si croissance continue): X.XX%

⚠️ Recherche automatisée, pas un conseil en investissement. La projection 5 ans suppose une croissance linéaire — la réalité diverge.
```
