---
name: altman-z-score
description: Calculates the Altman Z-Score to predict the probability of a company going bankrupt within the next two years. Triggers when user asks for bankruptcy risk, Altman, Z-Score, financial distress, or survival probability.
---

# Altman Z-Score Bankruptcy Risk Skill

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→5) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Le rapport final DOIT inclure : Z-Score numérique, breakdown des 5 composantes, verdict (Safe/Grey/Distress), et caveats sectoriels. Langue : FRANÇAIS.**

## Step 1: Gather Financial Data

Call `yahoo_summary` with `ticker=[TICKER]` (FREE, preferred). Extract from the response:

From `summaryDetail` / `keyStatistics`:
- `marketCap` (Market Value of Equity)

From `annualFinancials[0]` (most recent year):
- `currentAssets`, `currentLiabilities`
- `totalAssets`
- `totalLiabilitiesNetMinorityInterest` (= Total Liabilities)
- `retainedEarnings`
- `EBITDA` or compute `EBIT = operatingIncome` if EBITDA missing
- `totalRevenue` (Total Sales)

**Fallback:** if `yahoo_summary` data is incomplete, call `get_financials` with the query
`"[TICKER] balance sheet + income statement, latest annual"` (handles all metrics in one call —
do NOT split into multiple calls).

## Step 2: Calculate the 5 Components

Compute these ratios — show your work for each:

- **X1 (Liquidity)**: `(Current Assets - Current Liabilities) / Total Assets`
- **X2 (Cumulative Profitability)**: `Retained Earnings / Total Assets`
- **X3 (Operating Efficiency)**: `EBIT / Total Assets`
- **X4 (Market Assessment)**: `Market Cap / Total Liabilities`
- **X5 (Asset Turnover)**: `Total Sales / Total Assets`

If any input is missing, mark the corresponding component as `N/A` and **continue** — do not
abort. Note the missing input(s) in the final caveats so the reader can interpret the score
correctly.

## Step 3: Compute Final Z-Score

Apply the original Altman Z-Score formula for public manufacturing/non-financial companies:

`Z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 1.0 * X5`

*Note: For non-manufacturing service companies, use the Z'' variant
`Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4` (no X5) and adjust the bands accordingly. State
which variant you applied and why.*

## Step 4: Validate Inputs

- Confirm `Total Assets > 0` and `Total Liabilities > 0` — else mark Z-Score as `N/A`
- For financial companies (banks, insurers, REITs), the Z-Score is **not applicable** — surface
  this as a hard caveat and skip the verdict
- For pre-revenue / negative retained-earnings startups, the Z-Score will read as Distress
  even when the company is healthy from a runway perspective — flag this nuance explicitly

## Step 5: Tally and Output

```
═══════════════════════════════════════════════════
  ALTMAN Z-SCORE — [COMPANY] ([TICKER])
  Z = X.XX — [Safe / Grey / Distress] [emoji]
═══════════════════════════════════════════════════

📊 BREAKDOWN
| Composante                    | Valeur | Poids | Contribution |
| X1 Liquidity                  | X.XX   | 1.20  | X.XX         |
| X2 Cumulative Profitability   | X.XX   | 1.40  | X.XX         |
| X3 Operating Efficiency       | X.XX   | 3.30  | X.XX         |
| X4 Market Assessment          | X.XX   | 0.60  | X.XX         |
| X5 Asset Turnover             | X.XX   | 1.00  | X.XX         |
| ─────────────────────────────                        |
| Z-Score                                  | X.XX     |

🎯 ZONES
- Z > 2.99 → 🟢 Safe Zone
- 1.81 < Z < 2.99 → 🟡 Grey Zone
- Z < 1.81 → 🔴 Distress Zone

📌 VERDICT
[1–2 phrases: situation actuelle, principal driver, ce qu'il faut surveiller]

⚠️ CAVEATS
- Variante utilisée : Z classique / Z'' (services)
- Données manquantes : [le cas échéant]
- Secteur financier non couvert : [le cas échéant]
```
