---
name: master-analysis
description: Institutional-grade adaptive analysis with automatic maturity detection (startup/growth/mature), multi-factor scoring, star rating, entry prices, and BUY/WAIT/AVOID verdict. Triggers on any single stock ticker like "TSLA", "AAPL", "FLY", or requests for "analyse", "analysis".
---

# Master Analysis — Adaptive Intelligence

**INSTRUCTIONS STRICTES : Exécute TOUTES les phases (1→7) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Appelle TOUS les outils listés dans chaque phase. Le rapport final DOIT suivre le template OUTPUT exactement. Langue : FRANÇAIS.**

Elite equity research. Prioritize FREE tools. User trades on Trade Republic (EU).

## PHASE 1 — DATA (ONE CALL)
Call `yahoo_summary` for `[TICKER]`. This returns:
- `price`, `summaryDetail`, `keyStatistics`, `financialData` — quote, ratios, current financials
- `annualFinancials` — array of annual financial statements (revenue, netIncome, totalAssets, cashFlow, etc.)
- `quarterlyFinancials` — array of quarterly financial statements (same fields, per quarter)
- `earningsHistory`, `recommendations`, `insiderHolders` — earnings, analyst recs, insider data
Then call `yahoo_historical` for `[TICKER]` with period='1y' for technicals (MAs, support/resistance).

### ⚠️ RÈGLES DE QUALITÉ DES DONNÉES (CRITIQUE)
Les données proviennent de `fundamentalsTimeSeries` (la nouvelle API Yahoo). Applique ces règles :

1. **Revenue $0 ou N/A l'année précédente** : Si le revenu de l'année N-1 est $0, nul, ou absent, mais que l'année N montre du revenu > $0, cela signifie que l'entreprise vient de commencer à générer des revenus. → **Considérer comme croissance infinie → Score maximum (25/25) en Revenue Growth.**
2. **Données annuelles incomplètes** : Si `annualFinancials` n'a qu'1 seule entrée, utilise `quarterlyFinancials` pour reconstituer la croissance. Calcule la croissance QoQ (Quarter-over-Quarter) ou compare les 4 derniers trimestres aux 4 précédents.
3. **Revenus trimestriels en accélération** : Si les `totalRevenue` des trimestres augmentent séquentiellement (Q1 < Q2 < Q3 < Q4), c'est un signal fortement positif pour une startup → ajoute +5 en Market Traction (RevAccel).
4. **Champs clés** dans `annualFinancials`/`quarterlyFinancials` : `totalRevenue`, `netIncome`, `grossProfit`, `operatingIncome`, `totalAssets`, `totalDebt`, `cashAndCashEquivalents`, `freeCashFlow`, `operatingCashFlow`, `EBITDA`.
5. **Fallback** : Si `yahoo_summary` retourne des données insuffisantes (moins de 2 périodes), appelle `get_financials` pour `[TICKER]` comme source alternative (payante). Si ça échoue aussi, utilise `web_search` pour "[TICKER] annual revenue 2024 2025".

## PHASE 2 — MATURITY DETECTION
Classify from Phase 1 data:

**🚀 STARTUP** — ANY true: IPO < 3y, Operating Income negative 2+ years, Revenue < 3 years, Market Cap < $5B with no profitability, no positive annual FCF ever.

**📈 CROISSANCE** — ANY true: Revenue growth > 15% YoY AND 3-10 years old, recently turned profitable, Market Cap $5-50B with accelerating revenue, positive FCF in 1 of 3 years but not consistent.

**🏛️ MATURE** — ALL true: profitable 3+ years, positive FCF 2+ consecutive years, Market Cap > $10B OR public 10+ years, revenue growth < 15%.

## PHASE 3 — RSS + NEWS
Call `rss_intelligence` with query=`[TICKER]`, mode='company'. Extract: latest filings, breaking news, sentiment (🟢/🟡/🔴).

**Sentiment Scoring (obligatoire)** — Compte explicitement les articles : X positifs, Y négatifs, Z neutres.
Score Sentiment = `(positifs - négatifs) / total × 100`.
Intègre ce score dans le facteur **Momentum** :
- Score > 50 → +3 pts au Momentum
- Score 0 à 50 → +1 pt au Momentum
- Score < 0 → 0 pt au Momentum

Affiche le détail dans la section 2 du rapport : "Sentiment : +X / -Y / =Z → score XX/100".

## PHASE 4 — SEC RISK
Call `read_filings` for latest 10-K/10-Q. Fallback: `web_search`. Extract: #1 risk, going concern flags, forward guidance.

## PHASE 5 — ADAPTIVE SCORING (100 pts)

**Chain-of-thought obligatoire** : pour chaque facteur, EXPLIQUE ton raisonnement en 1 phrase avant de donner le score.
Pattern : `"Revenue Growth +25% YoY → seuil >25% → 12/12 pts"`.
Sans cette justification, le score n'est pas valide. Cela rend l'analyse auditable.

### 🚀 STARTUP Grid
| Factor | Max | Scoring |
|--------|-----|---------|
| Revenue Growth | 25 | >100% YoY=25, >50%=20, >25%=15, >10%=8, <10%=3 |
| Cash Runway | 20 | >3yr=20, >2yr=15, >1yr=10, <1yr=3. Runway=(Cash)/abs(QtrBurn) |
| Market Traction | 20 | GrossMargin>40%=10/>20%=6/>0%=3/neg=0 + RevAccel=+5 + Contracts(RSS)=+5 |
| Momentum | 20 | vs200dMA: >10%=10/0-10%=7/<0%=3/<-10%=0 + VolUp=+5 + Sentiment=+5 |
| Risk Structure | 15 | CurrRatio>3=8/>2=6/>1.5=4/<1.5=0 + NoConcern=+4 + InsiderBuy=+3 |

### 📈 CROISSANCE Grid
| Factor | Max | Scoring |
|--------|-----|---------|
| Growth | 25 | RevGr>25%=12/>15%=8/>8%=5/<8%=2 + EPSGr>20%=8/>10%=5/>0%=2/neg=0 + FCFimprove=+5 |
| Quality | 20 | GrossM>50%=8/>30%=5/>15%=3/<15%=0 + ROE>15%=6/>8%=4/>0%=2/neg=0 + Piotroski≥6=+6/≥4=+3 |
| Value | 20 | PEG<1=10/<1.5=7/<2=4/>2=0 + P/SvsSector: below=+5/inline=+3 + EV/Rev=+5 |
| Momentum | 20 | Same as Startup |
| Safety | 15 | D/E<1=6/<2=4/<5=2/>5=0 + CurrR>2=5/>1.5=3/<1.5=0 + AltmanZ>2.5=+4/>1.8=+2 |

### 🏛️ MATURE Grid
| Factor | Max | Scoring |
|--------|-----|---------|
| Value | 25 | P/EvsSector<0.7x=10/<1x=7/<1.3x=4/>1.3x=0 + PEG<0.8=8/<1.2=5/<2=2 + EV/EBITDA=+7 |
| Quality | 25 | Piotroski8-9=10/6-7=7/4-5=3/<4=0 + ROE>20%=8/>12%=5/>5%=2 + FCFMargin>15%=+7/>8%=+4 |
| Safety | 20 | AltmanZ>3.5=8/>2.5=5/>1.8=2/<1.8=0 + D/E<0.3=6/<0.8=4/<1.5=2 + CurrR>2=+6 |
| Dividends | 15 | Yield>3%=6/>1.5%=4/>0%=2/0=0 + Buyback=+5 + DivGrowth=+4 |
| Momentum | 15 | vs200dMA>10%=6/0-10%=4/below=1 + InsiderBuy=+5 + VolStable=+4 |

## Stars
| Score | Stars | Label |
|-------|-------|-------|
| 80-100 | ⭐⭐⭐⭐⭐ | PÉPITE |
| 65-79 | ⭐⭐⭐⭐ | SOLIDE |
| 50-64 | ⭐⭐⭐ | CORRECT |
| 35-49 | ⭐⭐ | FRAGILE |
| 0-34 | ⭐ | DANGER |

## PHASE 6 — VALUATION
🚀 Startup: P/S ratio vs peers (DCF N/A if FCF negative). Cash Runway as safety.
📈 Growth: DCF (invoke `skill` dcf-valuation) + PEG + EV/Revenue.
🏛️ Mature: DCF + P/E multiples + EV/EBITDA vs sector + dividend yield floor.

Entry prices:
- 🟢 Agressive = Intrinsic × 0.90
- 🟡 Conservatrice = Intrinsic × 0.75
- 🔴 Deep Value = Intrinsic × 0.60

## OUTPUT (French, mandatory)

```
╔═══════════════════════════════════════════════════════════╗
║  RAPPORT D'ANALYSE — [COMPANY] ([TICKER])                 ║
║  Date : [today]                                            ║
║  Profil : 🚀/📈/🏛️ [LABEL]                               ║
║  Score : XX/100 — ⭐⭐⭐⭐                                 ║
║  Verdict : 🟢 ACHETER / 🟡 ATTENDRE / 🔴 ÉVITER          ║
╚═══════════════════════════════════════════════════════════╝

🔍 PROFIL : [🚀/📈/🏛️] — [Why: "IPO récente, Op. Income négatif"]

📊 1. FINANCIERS CLÉS
   [3-year table: Revenue, Margins, FCF, EPS]

📡 2. VEILLE TEMPS RÉEL
   [Top 3-5 RSS items + sentiment 🟢/🟡/🔴]

⚠️ 3. RISQUE MAJEUR (SEC)
   [#1 risk + guidance]

🧬 4. SCORING ADAPTATIF (XX/100)
   [Factor bars + total + Piotroski/Altman if applicable]

⚖️ 5. VALORISATION
   [Method adapted to maturity]

💰 6. PRIX D'ENTRÉE (Trade Republic 🇪🇺)
   L'utilisateur trade sur Trade Republic en EUROS. Les prix Yahoo Finance sont en USD.
   Pour CHAQUE prix, affiche les deux devises. Utilise le taux EUR/USD du jour.
   Si le taux exact n'est pas disponible, utilise 1 USD ≈ 0.88 EUR comme approximation.
   
   🟢 Agressive: $XXX (~XX€) | 🟡 Conservatrice: $XXX (~XX€) | 🔴 Deep Value: $XXX (~XX€)
   Support: $XXX (~XX€) | 52w: $XXX—$XXX
   Prix actuel: $XXX (~XX€ sur Trade Republic)

📌 7. CONCLUSION
   [WHY buy/avoid, AT WHAT PRICE, CATALYSTS. Trade Republic availability.]

   📈 BACKTEST 1 AN (obligatoire)
   À partir de `yahoo_historical` (period='1y') récupère le prix de clôture le plus ancien (~365j)
   et compare-le au prix actuel : `rendement_1y = (prix_actuel - prix_1an) / prix_1an × 100`.
   Affiche la phrase : "Si vous aviez acheté il y a 1 an à $XXX, votre rendement aujourd'hui serait de ±XX%."
   Compare ce rendement au S&P 500 (^GSPC) sur la même période quand pertinent.

⚠️ Recherche automatisée, pas un conseil en investissement.
```
