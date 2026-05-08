---
name: piotroski-f-score
description: Calculates the Piotroski F-Score (0-9) to determine the fundamental financial strength of a company and identify potential value traps. Triggers when user asks for F-score, Piotroski, financial health, value trap analysis, or fundamental score.
---

# Piotroski F-Score Analysis Skill

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→5) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Le rapport final DOIT inclure : score numérique /9, breakdown des 9 critères avec valeurs comparées (TTM vs Y-1), et verdict. Langue : FRANÇAIS.**

## Step 1: Gather Financial Data

Call `yahoo_summary` with `ticker=[TICKER]`. Extract from the response:

From `annualFinancials` (use the **two most recent** entries — current year `Y0` and prior year `Y-1`):
- `netIncome`
- `operatingCashFlow`
- `totalAssets`
- `longTermDebt`
- `currentAssets`, `currentLiabilities`
- `totalRevenue`
- `grossProfit` (compute `grossMargin = grossProfit / totalRevenue` if direct field unavailable)

From `keyStatistics`:
- `sharesOutstanding` (current)
- `floatShares` (proxy)

**Fallback:** if Yahoo annual data has fewer than 2 entries, call `get_financials` with
`"[TICKER] annual income + balance sheet + cash flow, last 2 years"` (handles multi-statement
queries in one call — do NOT split).

## Step 2: Profitability Metrics (Max 4 points)

Show TTM values explicitly and award 1 point per criterion met:

1. **Positive Net Income**: `netIncome[Y0] > 0` → 1 pt
2. **Positive ROA**: `netIncome[Y0] / averageTotalAssets > 0` → 1 pt (where `averageTotalAssets = (totalAssets[Y0] + totalAssets[Y-1]) / 2`)
3. **Positive Operating Cash Flow**: `operatingCashFlow[Y0] > 0` → 1 pt
4. **Quality of Earnings**: `operatingCashFlow[Y0] > netIncome[Y0]` → 1 pt

## Step 3: Leverage / Liquidity / Source of Funds (Max 3 points)

5. **Decrease in Leverage**: `longTermDebt[Y0]/totalAssets[Y0] < longTermDebt[Y-1]/totalAssets[Y-1]` → 1 pt
6. **Increase in Liquidity**: `currentRatio[Y0] > currentRatio[Y-1]` (where `currentRatio = currentAssets / currentLiabilities`) → 1 pt
7. **No Dilution**: `sharesOutstanding[Y0] ≤ sharesOutstanding[Y-1]` → 1 pt
   - Use `keyStatistics.sharesOutstanding` as Y0 and prior year via `web_search "[TICKER] shares outstanding [Y-1]"` if not in `annualFinancials`. If unavailable, mark as N/A and award 0.

## Step 4: Operating Efficiency (Max 2 points)

8. **Increase in Gross Margin**: `grossMargin[Y0] > grossMargin[Y-1]` → 1 pt
9. **Increase in Asset Turnover**: `(totalRevenue[Y0]/avgAssets[Y0]) > (totalRevenue[Y-1]/avgAssets[Y-1])` → 1 pt

## Step 5: Tally and Output

```
═══════════════════════════════════════════════════
  PIOTROSKI F-SCORE — [COMPANY] ([TICKER])
  Score : X / 9 — [emoji]
═══════════════════════════════════════════════════

📊 BREAKDOWN
| # | Critère                              | Y0 | Y-1 | Pt |
| 1 | Net Income > 0                       |    |     |    |
| 2 | ROA > 0                              |    |     |    |
| 3 | Operating CF > 0                     |    |     |    |
| 4 | OCF > Net Income (qualité gains)     |    |     |    |
| 5 | LT Debt / Assets ↓                   |    |     |    |
| 6 | Current Ratio ↑                      |    |     |    |
| 7 | Shares outstanding non dilués        |    |     |    |
| 8 | Gross Margin ↑                       |    |     |    |
| 9 | Asset Turnover ↑                     |    |     |    |
| ─                                                       |
| TOTAL                                            X / 9  |

🎯 VERDICT
- 8–9 → 🟢 Force fondamentale exceptionnelle (signal d'achat fort)
- 5–7 → 🟡 Santé financière stable / moyenne
- 0–4 → 🔴 Santé fragile (potentiel piège de valeur)

📌 INTERPRÉTATION
[1–2 phrases: trend, principaux drivers, ce qu'il faut surveiller]

⚠️ CAVEATS
- Données manquantes (le cas échéant)
- Le F-Score est conçu pour des entreprises matures à modèle stable — applicabilité limitée pour startups / fintechs / banques.
```
