---
name: news-sentiment
description: Aggregates real-time news + social signals about a ticker or topic and produces a normalized 0-100 sentiment score with source attribution. Triggers on "sentiment [TICKER]", "what are people saying about [X]", "news [TICKER]", "buzz around [X]", "actualité [TICKER]", "sentiment marché sur [X]".
---

# News Sentiment — Multi-Source Sentiment Aggregator

**INSTRUCTIONS STRICTES : Exécute TOUTES les phases (1→4) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Le rapport DOIT contenir : score sentiment 0–100, ratio bullish/bearish/neutre, top 3 catalyseurs positifs et négatifs, et un signal de momentum news. Langue : FRANÇAIS sauf si l'utilisateur écrit en anglais.**

Mission : produire un signal sentiment grounded sur des sources réelles (RSS, web, X) plutôt que sur les souvenirs du LLM. Utilisable pour cross-check d'une analyse master-analysis, comme briefing rapide avant une position, ou comme baromètre quotidien sur un secteur.

## PHASE 1 — Cadrage de la cible

L'argument peut être un ticker (`AAPL`, `BTC`), un nom de société (`Firefly Aerospace`), un secteur (`AI stocks`), ou un thème macro (`Fed rate cuts`, `crypto regulation`).

- Si c'est un ticker stock : `mode = 'company'`, recherche centrée sur SEC + News + Press Releases
- Si c'est une crypto : `mode = 'general'`, recherche large + sources crypto
- Si c'est un secteur ou thème : `mode = 'general'`

## PHASE 2 — Collecte multi-source (en parallèle)

1. `rss_intelligence` `query=[CIBLE] mode=[mode] limit=15` — SEC + Google News + GlobeNewsWire
2. `web_search` `query="[CIBLE] news last 7 days analyst takes catalysts"` — articles longs et takes d'analystes
3. `web_search` `query="[CIBLE] bearish risks concerns 2026"` — angle short pour équilibrer le biais bullish des press releases
4. `x_search` (si disponible) — `command='search' query="$[TICKER] OR [name]" sort='likes' min_likes=10 since='3d'` — sentiment social brut, top tweets uniquement

Si X n'est pas configuré, ignore l'étape 4 et note "Source X indisponible — sentiment social non couvert" dans la section caveats.

## PHASE 3 — Scoring sentiment (méthode auditable)

Pour chaque item collecté, classer en :
- 🟢 **bullish** : tonalité positive explicite (beat, upgrade, partnership, growth, breakthrough, etc.)
- 🔴 **bearish** : tonalité négative explicite (miss, downgrade, lawsuit, fraud, layoff, supply issue, regulatory crackdown)
- ⚪ **neutre** : info factuelle sans direction (calendrier, mouvement de personnel non-significatif, simple update)

**Formule du score (0–100)**

```
total = bullish + bearish + neutre
score = round( ( (bullish - bearish) / total * 50 ) + 50 )
```

- Score = 100 → tout bullish
- Score = 50 → équilibré OU tout neutre
- Score = 0 → tout bearish

**Seuils interprétatifs**

| Score | Label | Signal |
|-------|-------|--------|
| 75-100 | 🟢🟢 Très positif | Momentum news fort, consensus positif |
| 60-74  | 🟢 Positif | Tendance positive, vérifier la fraîcheur |
| 45-59  | 🟡 Neutre | Pas de direction claire, attendre catalyseur |
| 25-44  | 🔴 Négatif | Tendance négative, prudence |
| 0-24   | 🔴🔴 Très négatif | Storm — éviter ou attendre stabilisation |

**Pondérations** (optionnel mais recommandé pour les sources de qualité variable)

- SEC filings (8-K, S-1, 10-Q) → poids ×1.5 (haute qualité, faible bruit)
- Press releases (GlobeNewsWire) → poids ×1.0 (souvent biais positif → ne JAMAIS ignorer le contenu négatif quand il apparaît)
- Google News → poids ×1.0
- Web search (Exa/Perplexity/Tavily) → poids ×1.0
- X tweets → poids ×0.5 (bruit élevé, sample bias)

## PHASE 4 — Output (français)

```
═══════════════════════════════════════════════════════════
  📡 SENTIMENT NEWS — [CIBLE]
  Date : [today] | Fenêtre : 7 derniers jours
═══════════════════════════════════════════════════════════

🌡️ SCORE SENTIMENT : XX/100 — [emoji + label]

Distribution : 🟢 X bullish | ⚪ Y neutre | 🔴 Z bearish (total N items)
Sources : SEC×A · News×B · Press×C · Web×D · X×E

🚀 TOP 3 CATALYSEURS POSITIFS
1. [headline + source + date]
2. [headline + source + date]
3. [headline + source + date]

⚠️ TOP 3 RISQUES / SIGNAUX NÉGATIFS
1. [headline + source + date]
2. [headline + source + date]
3. [headline + source + date]

📈 MOMENTUM NEWS (3j vs 7j antérieurs)
[Si volume d'items récents > 1.5× volume précédent → "🔥 Buzz en accélération"]
[Sinon si volume < 0.7× précédent → "💤 Calme inhabituel"]
[Sinon → "📊 Activité normale"]

🔗 SOURCES PRINCIPALES
- [URL 1 — titre]
- [URL 2 — titre]
- [URL 3 — titre]
- ...max 5 sources les plus citées

📌 LECTURE EN 3 PHRASES
[Phrase 1 : ce qui domine la conversation cette semaine]
[Phrase 2 : ce qui pourrait changer le score à court terme — catalyseur attendu]
[Phrase 3 : niveau de confiance dans le signal — "haut" si SEC + analystes alignés, "bas" si principalement social]

⚠️ Recherche automatisée. Le sentiment news est UN signal parmi d'autres — ne pas trader uniquement sur cette base. Combiner avec analyse fondamentale (master-analysis) et technique avant toute position.
```

## Cross-checks suggérés

Quand le score est extrême (≥80 ou ≤20), suggère explicitement à l'utilisateur :
- "Score très [positif/négatif] détecté → recommande de cross-check avec `master-analysis [TICKER]` pour valider les fondamentaux"
- "Si momentum en accélération → vérifier `earnings-calendar [TICKER]` pour identifier le catalyseur"

Ces suggestions sont des phrases dans la conclusion, PAS des invocations automatiques d'autres skills (l'utilisateur décide).
