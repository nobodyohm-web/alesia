---
name: opportunity-scanner
description: Ultra-aggressive daily stock opportunity scanner. Finds the highest-potential stocks for intraday/swing trading TODAY. Triggers on "/search", "search", "opportunities", "opportunités", "scanner", "best stocks today", "quelles actions", "meilleur achat".
---

# 🔥 OPPORTUNITY SCANNER — Chasseur d'Opportunités Actions

**INSTRUCTIONS STRICTES : Exécute TOUTES les phases (1→6) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Langue : FRANÇAIS. Tu dois produire un rapport COMPLET avec des recommandations d'entrée/sortie PRÉCISES.**

Mission : identifier les 5-10 meilleures actions à FORT potentiel pour aujourd'hui/cette semaine. Méthode multi-source, FREE-first.

## PHASE 1 — MACRO CONTEXT (2 min)

Commence par comprendre le contexte de marché. En parallèle :
1. `sector_performance` `includeBenchmarks=true` — UN appel pour SPY+QQQ+IWM + 11 ETFs sectoriels + régime risk-on/off (remplace 3 yahoo_quote séparés)
2. `yahoo_quote` ticker='^VIX' — niveau de volatilité (pas dans sector_performance)
3. `economic_calendar` `daysAhead=7 impact='high'` — events macro qui pourraient déclencher de la vol cette semaine
4. `web_search` "most active stocks today premarket movers" — movers du jour
5. `web_search` "stocks with unusual volume today breakout" — volumes anormaux

**Interprétation Macro rapide :**
- VIX < 18 + indices verts + sector_performance.regime = 'risk-on' → 🟢 RISK-ON → favoriser growth/momentum (top sectors)
- VIX > 25 ou indices rouges + regime = 'risk-off' → 🔴 RISK-OFF → favoriser value/défensifs (bottom sectors si rebond, top défensifs si protection)
- VIX 18-25 ou regime = 'neutral' → 🟡 sélectif, éviter sur-exposition
- ⚠️ Si `economic_calendar` montre un event majeur ≤3 jours (FOMC, CPI), réduire l'exposition aux setups directionnels et privilégier les paires/spreads

## PHASE 2 — SCANNING MULTI-SOURCE (le cœur)

### Source 1 : Screener quantitatif
`stock_screener` avec ces requêtes successives (3 scans) :

**Scan A — Momentum Breakout :**
"stocks with revenue growth above 20%, price change positive last week, P/E below 30, market cap above 1 billion"

**Scan B — Value à catalyseur :**
"stocks with P/E below 12, return on equity above 15%, free cash flow yield above 5%, market cap above 5 billion"

**Scan C — Growth explosif :**
"stocks with earnings growth above 30%, revenue growth above 25%, operating margin above 10%"

### Source 2 : News-driven momentum
`rss_intelligence` query="stocks breaking out earnings beat catalyst upgrade", mode='general'
`web_search` "stocks upgraded today analyst buy rating"
`web_search` "stocks with insider buying this week"

### Source 3 : Sentiment Twitter/X
`x_search` query="$stocks breakout today buy signal" (si X_BEARER_TOKEN disponible)

### Source 4 : Secteurs chauds
`web_search` "best performing sectors today stock market"
`web_search` "upcoming earnings this week stock catalysts"

## PHASE 3 — TOP 10 SÉLECTION + DEEP DIVE

À partir des résultats des 4 sources, identifie les **10 actions** qui apparaissent le plus souvent OU qui ont le meilleur profil risque/rendement.

Pour CHAQUE action du top 10 :
1. `yahoo_summary` ticker=[TICKER] — données complètes
2. `yahoo_historical` ticker=[TICKER] period='3mo' — pour niveaux techniques

**Critères de sélection pondérés :**
- 📈 **Momentum** (30%) : prix > MA50, volume en hausse, tendance haussière
- 💎 **Valeur** (25%) : P/E raisonnable, PEG < 2, EV/EBITDA sous la moyenne sectorielle
- 🚀 **Catalyseur** (25%) : earnings beat, upgrade analyste, insider buying, news positive
- 🛡️ **Sécurité** (20%) : current ratio > 1.5, pas de going concern, free cash flow positif

## PHASE 4 — SCORING & CLASSEMENT (100 pts par action)

Pour chaque action du top 10, attribue un score /100 :

| Critère | Max pts | Détail |
|---------|---------|--------|
| Momentum technique | 30 | Prix>MA50=10, Vol>moy=8, RSI 40-70=7, Tendance haussière=5 |
| Valeur fondamentale | 25 | PEG<1=10, P/E<secteur=8, FCF yield>3%=7 |
| Catalyseur immédiat | 25 | Earnings beat=10, Upgrade=8, Insider buy=5, News positive=2 |
| Sécurité/risque | 20 | Current ratio>2=8, Pas de dette excessive=7, FCF positif=5 |

**Classe les actions par score décroissant.**

## PHASE 5 — NIVEAUX DE TRADING PRÉCIS

Pour le **TOP 5** (les 5 meilleures), calcule des niveaux ULTRA-PRÉCIS :

### Niveaux d'entrée
- 🟢 **Entrée agressive** : prix actuel ou premier pullback (-1-2% du prix)
- 🟡 **Entrée conservatrice** : prochain support technique (MA20 ou swing low récent)
- 🔴 **Entrée deep value** : MA50 ou support majeur (swing low 3 mois)

### Take Profit (objectifs de sortie)
- 🎯 **TP1** (court terme, 1-5 jours) : prochaine résistance ou +5-8%
- 🎯 **TP2** (swing, 1-4 semaines) : résistance majeure ou +12-20%
- 🎯 **TP3** (position, 1-3 mois) : target analyste consensus ou +25-40%

### Stop Loss
- 🛑 **Stop Loss** : sous le support clé (-3-5% du prix d'entrée)
- Ratio risque/récompense MINIMUM : 2:1 (objectif 3:1)

### Timing
- ⏰ **Meilleur moment d'entrée** : ouverture si gap up modéré, 10h-10h30 après le premier pullback, 14h-15h si le support tient
- 📅 **Durée de détention** : intraday / swing (2-5j) / position (2-12 semaines)

## PHASE 6 — OUTPUT (français, format rapport)

```
╔═══════════════════════════════════════════════════════════╗
║  🔥 SCANNER D'OPPORTUNITÉS — [date]                       ║
║  Contexte : 🟢/🟡/🔴 [RISK-ON/SÉLECTIF/RISK-OFF]         ║
║  S&P 500 : XXXX (±X.X%) | VIX : XX.X | Nasdaq : XXXX     ║
║  Actions scannées : XX | Retenues : 10 | Top 5 présentés  ║
╚═══════════════════════════════════════════════════════════╝

🏆 CLASSEMENT — TOP 5 OPPORTUNITÉS DU JOUR

┌─────────────────────────────────────────┐
│ #1 — [TICKER] [NOM] — Score: XX/100     │
│ Prix: $XX.XX | Secteur: [SECTEUR]       │
├─────────────────────────────────────────┤
│ 📈 Momentum: XX/30 — [détail 1 ligne]  │
│ 💎 Valeur: XX/25 — [détail 1 ligne]    │
│ 🚀 Catalyseur: XX/25 — [détail]        │
│ 🛡️ Sécurité: XX/20 — [détail]         │
├─────────────────────────────────────────┤
│ NIVEAUX DE TRADING                      │
│ 🟢 Entrée agressive : $XX.XX (~XX€)    │
│ 🟡 Entrée conservatrice : $XX.XX (~XX€)│
│ 🎯 TP1 (5j) : $XX.XX (+X.X%)           │
│ 🎯 TP2 (4sem) : $XX.XX (+XX.X%)        │
│ 🎯 TP3 (3mois) : $XX.XX (+XX.X%)       │
│ 🛑 Stop Loss : $XX.XX (-X.X%)           │
│ ⚖️ Risk/Reward : 1:X.X                  │
│ ⏰ Timing : [ouverture/pullback/support] │
│ 📅 Holding : [intraday/swing/position]  │
│ 💡 Thèse en 1 phrase : [...]            │
└─────────────────────────────────────────┘

[Répéter pour #2 à #5]

📊 TABLEAU RÉCAPITULATIF

| # | Ticker | Score | Prix | TP1 | TP2 | SL | R/R | Signal |
|---|--------|-------|------|-----|-----|----|-----|--------|
| 1 | XXXX   | XX    | $XX  | $XX | $XX | $XX| X:X | 🟢     |
| ...                                                        |

🔥 ACTIONS HONORABLES (#6-#10)
[Liste rapide avec ticker, score, signal principal]

📌 STRATÉGIE DU JOUR
[2-3 phrases : bias directionnel, secteurs à privilégier, risques à monitorer, attitude globale]

⚠️ Recherche automatisée, pas un conseil en investissement. Positions à dimensionner selon votre tolérance au risque.
```
