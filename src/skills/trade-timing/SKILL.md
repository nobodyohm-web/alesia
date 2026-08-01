---
name: trade-timing
description: Plan de trade complet sur un horizon donné — biais multi-timeframe, zone d'entrée, stop structurel, objectifs en R, taille de position et score de confiance décomposé. Se déclenche sur "quand acheter", "quand vendre", "point d'entrée", "stop", "objectif", "swing", "day trading", "scalp", "setup", "trade", "short", "long", "à quel prix".
---

# Trade Timing — Quand entrer, où sortir

**INSTRUCTIONS STRICTES : exécute TOUTES les phases sans interruption. Ne demande JAMAIS "comment procéder". Langue : FRANÇAIS. Aucun niveau technique ne doit venir de ta mémoire — tout sort des outils.**

Mission : transformer « est-ce que j'achète ? » en un plan exécutable, ou en un « non » argumenté.

## PHASE 0 — CADRAGE

Détermine l'horizon demandé. En cas d'ambiguïté, prends `swing` et dis-le explicitement dans le rapport.

| Signal dans la demande | Horizon |
|---|---|
| "day trading", "scalp", "intraday", "aujourd'hui", "cette séance" | `day` |
| "swing", "quelques jours", "cette semaine", "court terme" | `swing` |
| "quelques mois", "moyen terme", "position" | `medium` |
| "long terme", "investir", "garder des années", "PEA", "fond de portefeuille" | `long` |

Si l'utilisateur a mentionné une taille de compte ou un budget de risque, passe-les à `trade_setup` (`accountSize`, `riskPercent`). Sinon n'invente rien : omets le sizing.

## PHASE 1 — DONNÉES (en parallèle)

1. `trade_setup` avec `symbol`, `horizon`, `direction='auto'` — le plan lui-même. **Toujours en premier.**
2. `memory_search` "positions objectifs tolérance risque {ticker}" — ce que tu sais déjà de l'utilisateur. **Obligatoire avant toute recommandation personnalisée.**
3. `trade_journal` `action='review'` `symbolFilter={ticker}` — le bilan des trades passés sur ce titre et cet horizon.

Puis, selon l'horizon :

- **day / swing** : `technical_analysis` sur les 2 unités de temps voisines si le setup est ambigu ; `economic_calendar` (7 jours) pour les événements à haut impact ; pour une action US, vérifie la date de résultats — un gap traverse le stop.
- **medium / long** : `treasury_yields` (taux sans risque), `yahoo_key_stats` + `analyst_consensus` pour la valorisation. **En `long`, la valorisation décide et le graphique ne fait que timer l'entrée** — n'ouvre jamais une position long terme sur un signal technique seul.
- **crypto** : `binance_futures_positioning` — funding, open interest, ratios long/short. Un funding très positif signale un consensus long encombré, donc un risque de squeeze.
- **action US, biais short** : `short_interest` — un days-to-cover élevé change complètement le risque d'un short.

## PHASE 2 — CONTRÔLES AVANT DE CONCLURE

Vérifie ces points et mentionne ceux qui échouent :

- **Le R:R atteint-il le minimum de l'horizon ?** (1.5 day / 2 swing / 2.5 medium / 3 long). Sinon : le setup existe mais ne se joue pas — attends un meilleur prix.
- **Le stop est-il structurel ?** Si `structuralCapped` est vrai, dis-le : le stop est volatilité pure, donc de moindre qualité.
- **Les unités de temps sont-elles alignées ?** Si elles divergent, l'attente est la position.
- **Un événement programmé tombe-t-il dans la durée de détention ?** Résultats, FOMC, CPI.
- **Le journal dit-il quelque chose ?** Si l'expectancy est négative sur ce type de setup, signale-le avant de recommander.

## PHASE 3 — RAPPORT (français, format obligatoire)

```
╔═══════════════════════════════════════════════════════════╗
║  PLAN DE TRADE — [TICKER]                                 ║
║  Horizon : [⚡ Day / 📊 Swing / 📈 Moyen / 🏛️ Long]        ║
║  Sens : 🟢 LONG / 🔴 SHORT / ⚪ ABSTENTION                 ║
║  Confiance : XX/100                                       ║
╚═══════════════════════════════════════════════════════════╝

🎯 DÉCISION
   [Une phrase. Soit "Acheter dans la zone X–Y", soit "Attendre que Z se produise",
    soit "Pas de setup — voici pourquoi".]

⏱️ TIMING : [Entrer maintenant / Attendre le repli / Attendre la cassure / Attendre confirmation]
   Déclencheur : [la condition exacte, avec l'unité de temps]

📍 NIVEAUX
   Entrée : X–Y (idéal Z)
   Stop : S  ([n] ATR, −[m]%) — [méthode]
   T1 : [prix] ([r]R) — [base]
   T2 : [prix] ([r]R) — [base]
   [T3 si présent]
   R:R : [x]R

💰 TAILLE  [uniquement si accountSize fourni]
   [n] unités = [notional] ([p]% du compte), risque [montant] ([r]% du compte)

🧬 CONFIANCE XX/100 — DÉCOMPOSITION
   [Chaque facteur : nom, points/max, note. Reprends-les tels quels, ne les résume pas.]

⚠️ INVALIDATION
   [Ce qui tue l'idée, et à quel niveau exactement]

🔭 CONTEXTE
   [Tendance sur l'unité supérieure, régime, niveaux clés, événements à venir]

📓 HISTORIQUE
   [Ce que dit le journal sur ce titre / cet horizon. "Aucun historique" si vide.]

📌 CE QUI CHANGERAIT MON AVIS
   [1–2 conditions concrètes et observables]

⚠️ Analyse automatisée, pas un conseil en investissement.
```

## PHASE 4 — JOURNALISATION

Si le plan est actionnable (timing ≠ `stand-aside`) **et** que l'utilisateur indique qu'il prend la position, appelle `trade_journal` `action='log'` avec le symbole, le sens, l'horizon, l'entrée, le stop, l'objectif, la thèse en une phrase et le score de confiance.

Ne journalise pas une idée que l'utilisateur n'a pas prise : le journal mesure des décisions réelles, pas des suggestions.

## RÈGLES

- **Jamais de niveau de mémoire.** Tous les prix viennent des outils.
- **« Pas de setup » est une réponse complète.** Ne fabrique pas une entrée pour paraître utile. Explique ce qui manque et ce qu'il faudrait voir.
- **Ne mélange jamais les horizons.** Une entrée day avec un stop long terme est incohérente.
- **Ne force pas un sens contre l'unité de temps supérieure.** Si l'utilisateur demande explicitement un short en tendance haussière, donne-le mais affiche la pénalité et le risque.
- **Le sizing est de l'arithmétique.** Si la taille calculée dépasse le compte, la réponse est une position plus petite, jamais un stop plus large.
- Si `trade_setup` échoue sur un horizon `day` pour une action, explique la limite (Yahoo ne sert que ~55 jours d'intraday, et rien hors séance) et propose `swing`.
