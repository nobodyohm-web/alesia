---
name: multi-factor-scoring
description: Applies a rigorous multi-factor scoring model inspired by MIT FinTechAI research combining fundamental, technical, and sentiment signals. Triggers when user asks for "full score", "multi-factor", "quant analysis", "complete scoring", or "rate this stock scientifically".
---

# Multi-Factor Scoring Model — MIT FinTechAI-Inspired

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (Factor 1→5) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Pour CHAQUE métrique, justifie le score en 1 phrase (chain-of-thought). Le rapport DOIT inclure : radar des 5 facteurs, table détaillée, score global /100, et verdict ACHETER/ATTENDRE/ÉVITER. Langue : FRANÇAIS.**

This skill implements a 100-point multi-factor scoring model combining 5 research-backed dimensions.
Based on: MIT CSAIL FinTechAI research on human-AI collaborative financial analysis, multi-modal signal synthesis, and factor-based modeling.

## Data Acquisition

Call `yahoo_summary` for `[TICKER]` ONCE to get all required fields. Then call:
- `analyst_consensus` for forward guidance & analyst recs (Factor 3 row 4)
- `insider_detector` for insider activity (Factor 4 row 4)
- `read_filings` for SEC filing risks (Factor 5 row 4) — fall back to `web_search "[TICKER] 10-K risk factors"` if unavailable

These calls are independent — invoke them in parallel.

## Factor 1: VALUE (0-20 pts)
Use `yahoo_key_stats` and financial tools to score:

| Metric | 5 pts | 3 pts | 1 pt | 0 pts |
|--------|-------|-------|------|-------|
| P/E vs Sector Median | <0.7x | 0.7-1.0x | 1.0-1.3x | >1.3x |
| PEG Ratio | <0.8 | 0.8-1.2 | 1.2-2.0 | >2.0 |
| P/FCF | <12 | 12-20 | 20-30 | >30 or negative |
| EV/EBITDA vs Sector | <0.7x | 0.7-1.0x | 1.0-1.3x | >1.3x |

## Factor 2: QUALITY (0-20 pts)
Use Piotroski + Altman + additional quality metrics:

| Metric | 5 pts | 3 pts | 1 pt | 0 pts |
|--------|-------|-------|------|-------|
| Piotroski F-Score | 8-9 | 6-7 | 4-5 | 0-3 |
| ROE | >20% | 12-20% | 5-12% | <5% |
| Debt/Equity | <0.3 | 0.3-0.8 | 0.8-1.5 | >1.5 |
| FCF Margin | >15% | 8-15% | 2-8% | <2% or negative |

## Factor 3: GROWTH (0-20 pts)
Use income statements and analyst estimates:

| Metric | 5 pts | 3 pts | 1 pt | 0 pts |
|--------|-------|-------|------|-------|
| Revenue Growth (YoY) | >25% | 10-25% | 2-10% | <2% or negative |
| EPS Growth (YoY) | >20% | 8-20% | 0-8% | Negative |
| FCF Growth (YoY) | >15% | 5-15% | 0-5% | Negative |
| Forward Guidance | Beat + Raise | Beat | In-line | Miss |

## Factor 4: MOMENTUM (0-20 pts)
Use `yahoo_historical` and `yahoo_quote`:

| Metric | 5 pts | 3 pts | 1 pt | 0 pts |
|--------|-------|-------|------|-------|
| Price vs 200-day MA | >10% above | 0-10% above | 0-10% below | >10% below |
| Price vs 52-week range | Top 25% | Middle 50% | Bottom 25% but rising | Bottom 25% and falling |
| Volume Trend (30d) | Rising strongly | Slightly rising | Flat | Declining |
| Insider Activity | Net buying | No activity | Small selling | Large selling |

## Factor 5: SAFETY (0-20 pts)
Use Altman Z-Score + balance sheet + filing analysis:

| Metric | 5 pts | 3 pts | 1 pt | 0 pts |
|--------|-------|-------|------|-------|
| Altman Z-Score | >3.5 | 2.5-3.5 | 1.8-2.5 | <1.8 |
| Current Ratio | >2.0 | 1.5-2.0 | 1.0-1.5 | <1.0 |
| Interest Coverage | >8x | 4-8x | 2-4x | <2x |
| SEC Filing Risks | Minor/standard | Moderate | Significant | Going concern |

## Final Score Interpretation

| Score | Rating | Action |
|-------|--------|--------|
| 80-100 | ⭐⭐⭐⭐⭐ EXCEPTIONNEL | 🟢 ACHETER — Position complète |
| 65-79 | ⭐⭐⭐⭐ TRÈS BON | 🟢 ACHETER — Position partielle |
| 50-64 | ⭐⭐⭐ CORRECT | 🟡 ATTENDRE un meilleur prix |
| 35-49 | ⭐⭐ FAIBLE | 🟡 ATTENDRE ou réduire position |
| 0-34 | ⭐ DANGER | 🔴 ÉVITER ou VENDRE |

## Output Format

```
═══════════════════════════════════════════════════
  SCORING MULTI-FACTEURS — [COMPANY] ([TICKER])
  Score Global : XX/100 — ⭐⭐⭐⭐
  Verdict : 🟢 ACHETER
═══════════════════════════════════════════════════

📊 RADAR DES 5 FACTEURS

  Valeur     : ██████████████░░░░░░ 14/20
  Qualité    : ████████████████░░░░ 16/20
  Croissance : ██████████░░░░░░░░░░ 10/20
  Momentum   : ████████████████████ 20/20
  Sécurité   : ██████████████░░░░░░ 14/20
  ─────────────────────────────
  TOTAL      : 74/100 ⭐⭐⭐⭐

📋 DÉTAIL PAR FACTEUR
  [Table with each metric, its value, and points awarded]

💰 PRIX D'ENTRÉE RECOMMANDÉ
  [Based on technical support levels and valuation]

📌 SYNTHÈSE EN 3 PHRASES
  [Why buy/avoid, at what price, what to watch]

⚠️ Recherche automatisée, pas un conseil en investissement. Le scoring multi-facteurs est un outil d'aide à la décision, pas une recommandation.
```
