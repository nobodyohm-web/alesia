---
name: dcf-valuation
description: Performs discounted cash flow (DCF) valuation analysis to estimate intrinsic value per share. Triggers when user asks for fair value, intrinsic value, DCF, valuation, "what is X worth", price target, undervalued/overvalued analysis, or wants to compare current price to fundamental value.
---

# DCF Valuation Skill

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→8) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Appelle TOUS les outils listés. Le rapport final DOIT inclure : valeur intrinsèque par action, upside/downside vs prix actuel, matrice de sensibilité 3×3, et caveats. Langue : FRANÇAIS sauf si l'utilisateur écrit en anglais.**

## Workflow Checklist

Copy and track progress:
```
DCF Analysis Progress:
- [ ] Step 1: Gather financial data
- [ ] Step 2: Calculate FCF growth rate
- [ ] Step 3: Estimate discount rate (WACC)
- [ ] Step 4: Project future cash flows (Years 1-5 + Terminal)
- [ ] Step 5: Calculate present value and fair value per share
- [ ] Step 6: Run sensitivity analysis
- [ ] Step 7: Validate results
- [ ] Step 8: Present results with caveats
```

## Step 1: Gather Financial Data

**Primary path (FREE, preferred):** Call `yahoo_summary` once with `ticker=[TICKER]`. It returns
`price`, `summaryDetail`, `keyStatistics`, `financialData`, `annualFinancials` (4y), and
`quarterlyFinancials` (last 4 quarters) in a single batched call.

Then call `analyst_consensus` with `ticker=[TICKER]` to pull target prices and analyst count
for cross-validation.

**Fallback path:** if `yahoo_summary` returns insufficient data, call `get_financials` with the
natural-language query `"[TICKER] annual cash flow + balance sheet + market cap, last 5 years"`
(it handles multi-statement queries internally — do NOT split into multiple calls).

### Fields to extract

From `yahoo_summary.financialData`: `freeCashflow`, `operatingCashflow`, `currentPrice`,
`returnOnEquity`, `debtToEquity`, `revenueGrowth`, `marketCap`, `enterpriseValue`.

From `yahoo_summary.keyStatistics`: `sharesOutstanding`, `enterpriseToEbitda`, `priceToBook`,
`forwardPE`, `pegRatio`, `enterpriseValue`, `floatShares`.

From `yahoo_summary.annualFinancials` (last 4 years, sorted oldest→newest): `freeCashFlow`,
`operatingCashFlow`, `capitalExpenditure`, `totalRevenue`, `netIncome`. Use these to compute
the 4-year FCF CAGR.

**Fallback** if `freeCashFlow` missing on an entry: compute it as
`operatingCashFlow − capitalExpenditure`.

From `analyst_consensus`: `priceTargets.mean`, `priceTargets.upsidePct`,
`priceTargets.numberOfAnalysts`. Use as a sanity check on the DCF output.

### Sector WACC

Pull `sector` from `yahoo_summary.summaryDetail.industry` (or fallback `web_search "[TICKER] sector industry"`).
Use the `sector` to select the appropriate base WACC range from [sector-wacc.md](sector-wacc.md).

## Step 2: Calculate FCF Growth Rate

Calculate FCF CAGR from the `annualFinancials` cash-flow history (typically 3–4 years).

**Cross-validate with:** `revenueGrowth` from `financialData`, and analyst forward-EPS growth
implied by `priceTargets.mean / currentPrice`.

**Growth rate selection:**
- Stable FCF history → Use CAGR with 10–20% haircut
- Volatile FCF (one or more negative years) → Weight `revenueGrowth` more heavily, halve the CAGR
- **Cap at 15%** (sustained higher growth is rare)
- **Floor at 0%** for cash-burning companies — DCF is not appropriate; flag this in caveats and use a P/Sales heuristic instead

## Step 3: Estimate Discount Rate (WACC)

**Use the `sector` from company facts** to select the appropriate base WACC range from [sector-wacc.md](sector-wacc.md).

**Default assumptions:**
- Risk-free rate: 4%
- Equity risk premium: 5-6%
- Cost of debt: 5-6% pre-tax (~4% after-tax at 30% tax rate)

Calculate WACC using `debtToEquity` (from `financialData`) for capital structure weights. If
missing, default to a sector-typical 70% equity / 30% debt mix.

**Reasonableness check:** WACC should be 2-4% below `returnOnEquity` for value-creating companies.

**Sector adjustments:** Apply adjustment factors from [sector-wacc.md](sector-wacc.md) based on company-specific characteristics.

## Step 4: Project Future Cash Flows

**Years 1-5:** Apply growth rate with 5% annual decay (multiply growth rate by 0.95, 0.90, 0.85, 0.80 for years 2-5). This reflects competitive dynamics.

**Terminal value:** Use Gordon Growth Model with 2.5% terminal growth (GDP proxy).

## Step 5: Calculate Present Value

Discount all FCFs → sum for Enterprise Value → subtract Net Debt (from `totalDebt − cashAndCashEquivalents`) → divide by `sharesOutstanding` for fair value per share.

## Step 6: Sensitivity Analysis

Create 3×3 matrix: WACC (base ±1%) vs terminal growth (2.0%, 2.5%, 3.0%).

## Step 7: Validate Results

Before presenting, verify these sanity checks:

1. **EV comparison**: Calculated EV should be within 30% of reported `enterpriseValue` (from `keyStatistics`)
   - If off by >30%, revisit WACC or growth assumptions

2. **Terminal value ratio**: Terminal value should be 50-80% of total EV for mature companies
   - If >90%, growth rate may be too high
   - If <40%, near-term projections may be aggressive

3. **Per-share cross-check**: Compare to `(freeCashflow / sharesOutstanding) × 15-25` as rough sanity check

4. **Analyst cross-check**: If `analyst_consensus.priceTargets.mean` differs from your DCF by >35%, surface the discrepancy in the caveats and explain the most likely driver (different growth assumption, different WACC, etc.)

If validation fails, reconsider assumptions before presenting results.

## Step 8: Output Format

Present a structured summary including:
1. **Valuation Summary**: Current price vs. fair value, upside/downside percentage
2. **Key Inputs Table**: All assumptions with their sources
3. **Projected FCF Table**: 5-year projections with present values
4. **Sensitivity Matrix**: 3×3 grid varying WACC (±1%) and terminal growth (2.0%, 2.5%, 3.0%)
5. **Caveats**: Standard DCF limitations plus company-specific risks
