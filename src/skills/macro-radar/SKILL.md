---
name: macro-radar
description: Real-time macro market radar — Fed rates, inflation, VIX, global sentiment, and breaking macro news. Triggers on "macro", "marché", "marche", "fed", "taux", "inflation", "vix", "fomc", or any general market state question.
---

# Macro Radar — Vue d'ensemble du marché

**INSTRUCTIONS STRICTES : Exécute TOUTES les phases (1→3) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Le rapport DOIT contenir : régime VIX, taux Fed + prochain FOMC, CPI YoY, sentiment, et **un tableau de performance sectorielle**. Langue : FRANÇAIS.**

Mission : produire un snapshot rapide de l'état macro actuel pour cadrer les décisions d'investissement. FREE-first, parallèle, concis.

## PHASE 1 — DATA (en parallèle quand possible)

1. `sector_performance` `includeBenchmarks=true` — UN SEUL appel pour SPY+QQQ+IWM+11 ETFs sectoriels + régime risk-on/off (remplace 14 yahoo_quote séparés)
2. `yahoo_quote` ticker='^VIX' — niveau VIX (pas dans sector_performance)
3. `yahoo_quote` ticker='^TNX' — yield 10Y Treasury
4. `economic_calendar` `daysAhead=14 country='us' impact='high'` — prochains FOMC / CPI / NFP / GDP
5. `rss_intelligence` query="Fed rates inflation CPI FOMC", mode='general' `limit=10` — news macro chaudes
6. `rss_intelligence` query="VIX market volatility S&P 500", mode='general' `limit=5` — sentiment de marché
7. `web_search` "current Fed funds rate target range CME FedWatch" — taux directeur + probabilités
8. `fear_greed_index` `limit=7` — ce baromètre crypto sert aussi de signal risk-on/off global

Si une source échoue, fallback sur `web_search` avec un wording plus spécifique.

## PHASE 2 — INTERPRÉTATION

### Régime de risque (VIX)
- VIX < 15 : 🟢 Complacent — appétit pour le risque élevé
- VIX 15-20 : 🟡 Calme — conditions normales
- VIX 20-30 : 🟠 Nerveux — volatilité élevée
- VIX > 30 : 🔴 Panique — stress de marché

### Politique monétaire
Identifier : taux Fed actuel, prochain meeting FOMC, dernière déclaration de Powell, probabilités CME FedWatch (hike / hold / cut).

### Inflation
Comparer le CPI YoY actuel avec la cible Fed (2%). Tendance : désinflation / réaccélération / stable.

### Sentiment global
Compter dans les RSS : combien d'articles bearish vs bullish vs neutres. Score = (bull - bear) / total × 100.

## PHASE 3 — OUTPUT (français, format box)

```
╔═══════════════════════════════════════════════════════════╗
║  MACRO RADAR — [date]                                     ║
║  Régime : 🟢/🟡/🟠/🔴 [LABEL]                             ║
╚═══════════════════════════════════════════════════════════╝

📊 1. INDICES CLÉS
   S&P 500 : XXXX (±X.X% jour)
   Nasdaq  : XXXX (±X.X% jour)
   VIX     : XX.X — [interprétation]
   10Y     : X.XX%

🏦 2. POLITIQUE MONÉTAIRE (Fed)
   Taux directeur : X.XX—X.XX%
   Prochain FOMC : [date]
   Marché price : [hike/hold/cut probability]

💹 3. INFLATION
   CPI YoY : X.X% (vs 2% cible)
   Tendance : [désinflation / réaccélération / stable]

🗓️ 4. ÉVÉNEMENTS À VENIR (14 jours)
   [Liste les événements de `economic_calendar` par ordre chronologique. Met en évidence les events ≤7 jours.]
   • [date] — [event] — Impact : 🔴/🟠/🟡 — Forecast : X.X% / Previous : X.X%

📊 5. ROTATION SECTORIELLE (issu de `sector_performance`)
   Régime : 🟢 Risk-On / 🔴 Risk-Off / 🟡 Neutre
   Top 3 secteurs (jour) : [emoji ticker (±X.X%)]
   Bottom 3 secteurs (jour) : [emoji ticker (±X.X%)]
   Lecture : [1 phrase — qu'est-ce que la rotation dit du marché ?]

📡 6. NEWS MACRO (top 5)
   • [headline + source + sentiment]
   • ...

🌡️ 7. SENTIMENT GLOBAL
   Bullish : X | Neutre : Y | Bearish : Z
   Score news : XX/100 | Fear & Greed crypto : XX/100

🎯 8. IMPLICATIONS POUR L'INVESTISSEUR
   [2-3 puces actionnables : croissance vs value, secteurs gagnants/perdants, risque à monitorer, fenêtres de volatilité macro à éviter]

⚠️ Recherche automatisée, pas un conseil en investissement.
```
