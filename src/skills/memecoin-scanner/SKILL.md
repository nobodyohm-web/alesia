---
name: memecoin-scanner
description: Memecoin and micro-cap crypto scanner. Finds the most explosive memecoin opportunities with maximum degen precision. Triggers on "/memecoin", "memecoin", "meme coin", "degen", "100x", "moonshot", "gem", "shitcoin", "pump", "pepe", "doge momentum".
---

# 🐸 MEMECOIN SCANNER — Chasseur de Gems & Moonshots

**INSTRUCTIONS STRICTES : Exécute TOUTES les phases (1→6) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Langue : FRANÇAIS. Ce skill est ULTRA-RISQUÉ par nature — les memecoins sont la classe d'actifs la plus volatile. Les avertissements de risque sont OBLIGATOIRES.**

Mission : identifier les 5-10 memecoins avec le plus fort potentiel explosif. Approche degen mais DISCIPLINÉE — on cherche le 10x mais on protège le capital.

## PHASE 1 — MEMECOIN MARKET PULSE

En parallèle :
1. `binance_price` symbol='DOGEUSDT' — Doge comme baromètre memecoin
2. `binance_price` symbol='SHIBUSDT' — Shib comme baromètre
3. `binance_price` symbol='PEPEUSDT' — Pepe comme baromètre
4. `binance_top_movers` direction='gainers' limit=30 — tous les gainers (memes souvent en tête)
5. `fear_greed_index` `limit=1` — risk-on / risk-off filter (memes thrivent quand index > 60)
6. `crypto_market_cap` `category='meme-token' limit=50` — top 50 memecoins par MCap (référence officielle CoinGecko)
7. `web_search` "trending memecoins today pump volume"
6. `web_search` "memecoin new listing Binance today"
7. `web_search` "top meme coins market cap today CoinGecko"
8. `x_search` "memecoin gem 100x today" (si disponible)

**Filtre initial :**
- Source d'autorité : `crypto_market_cap` Phase 1 (catégorie meme-token) — utilise cette liste comme univers, pas tes souvenirs
- Cross-check Binance gainers : ne retiens que les memes listés sur Binance (sécurité minimum)
- Memecoins reconnus sur Binance : DOGE, SHIB, PEPE, FLOKI, BONK, WIF, MEME, BOME, TURBO, NEIRO, ACT, PNUT, 1000SATS
- Pour les nouveaux memes hors top 50 : exiger volume 24h > $10M (filtre liquidité minimum)

## PHASE 2 — DEEP SCAN SOCIAL + VIRAL

Les memecoins sont driven par la hype sociale, PAS par les fondamentaux. Scanner :

### Source 1 : Twitter/X (signal #1 pour les memes)
`x_search` "memecoin breakout pump today buy"
`x_search` "$PEPE $DOGE $SHIB $FLOKI $BONK moon"
`web_search` "trending crypto twitter today memecoin"

### Source 2 : Reddit/Forums
`web_search` "reddit best memecoin today r/cryptocurrency"
`web_search` "memecoin trending on reddit today"

### Source 3 : Listings & Catalyseurs
`web_search` "new memecoin listing Binance Coinbase exchange 2025"
`web_search` "Elon Musk crypto tweet today" — impact direct sur DOGE/memes
`web_search` "memecoin burn event today supply reduction"

### Source 4 : On-chain signals
`web_search` "whale buying memecoin today large transactions"
`web_search` "memecoin holder count growing today"

## PHASE 3 — ANALYSE TECHNIQUE PAR MEMECOIN

Pour CHAQUE memecoin du top 10 :
1. `binance_price` symbol=[SYMBOL]USDT — prix et stats 24h
2. `binance_klines` symbol=[SYMBOL]USDT interval='1h' limit=48 — les 48 dernières heures
3. `binance_klines` symbol=[SYMBOL]USDT interval='1d' limit=14 — les 14 derniers jours

**Calculs obligatoires :**
- Prix actuel vs ATH (All-Time High) : % de distance
- Volume 24h vs volume moyen 7j (ratio de surge)
- Tendance courte (48h) : pump / dump / range / accumulation
- Support immédiat (low des 48h)
- Résistance immédiate (high des 48h)
- "Pump fatigue" : si déjà +50% en 24h → DANGER de dump, entrée DÉCONSEILLÉE sauf pullback

## PHASE 4 — SCORING MEMECOIN DEGEN (100 pts)

**ATTENTION : Les critères sont DIFFÉRENTS des actions/crypto classiques. Les memecoins suivent des règles différentes.**

| Critère | Max | Détail |
|---------|-----|--------|
| Hype sociale | 30 | Trending Twitter=15, Reddit mentions=8, Influencer push=7 |
| Volume surge | 25 | Vol ratio>5x=25, >3x=20, >2x=15, >1.5x=10, <1.5x=5 |
| Pattern technique | 20 | Accumulation=15, Breakout frais(<2h)=20, Pump en cours=10, Post-dump=5 |
| Catalyseur | 15 | New listing=15, Celebrity tweet=12, Burn event=10, Airdrop=8 |
| Sécurité relative | 10 | Sur Binance=5, MCap>$100M=3, Pas de rug pull flag=2 |

**WARNINGS AUTOMATIQUES :**
- Score < 40 → ❌ SKIP — trop risqué même pour du degen
- Pump > 100% en 24h → ⚠️ "ENTRÉE TARDIVE — risque de dump imminent"
- Volume en baisse malgré prix en hausse → ⚠️ "DIVERGENCE — probable bull trap"
- Token non listé sur Binance/Coinbase → ⚠️ "RISQUE DE RUG PULL ÉLEVÉ"

## PHASE 5 — NIVEAUX DE TRADING DEGEN

Pour le **TOP 5** :

### Position sizing (CRITIQUE)
- 💰 **MAX 1-2% du portfolio par memecoin** — JAMAIS plus
- 🎰 **Approche "lottery ticket"** — investir UNIQUEMENT ce qu'on est prêt à perdre à 100%
- 📊 **Spread** — répartir sur 3-5 memes plutôt que all-in sur un seul

### Niveaux d'entrée
- 🟢 **Entrée FOMO** (agressive) : prix actuel si le volume surge est confirmé
- 🟡 **Entrée pullback** : -10-15% du prix actuel (premier dip après pump)
- 🔴 **Entrée deep** : support 48h ou -20-25%

### Take Profit (stratégie par paliers)
- 🎯 **TP1 — Scalp** : +20-30% → vendre 30% de la position
- 🎯 **TP2 — Swing** : +50-80% → vendre 30% de la position
- 🎯 **TP3 — Moon** : +100-200% → vendre 30% de la position
- 🎯 **TP4 — Lambo** : +300%+ → laisser courir les 10% restants avec SL au breakeven

### Stop Loss (NON NÉGOCIABLE)
- 🛑 **SL serré** : -15-20% max (les memes bougent vite, pas de SL large)
- 🛑 **SL mental** : si le volume s'effondre > 50% en 4h → sortir immédiatement
- 🛑 **Règle d'or** : si le pump date de > 24h et que le prix stagne → prendre les profits

### Timing Memecoin
- ⏰ **Heure magique** : 14h-17h UTC (ouverture US) — volume max, momentum max
- ⏰ **Deuxième vague** : 08h-10h UTC (ouverture Asie) — deuxième pic de volume
- 🚫 **Éviter** : dimanche soir, lundis avant 14h UTC, jours fériés US

## PHASE 6 — OUTPUT

```
╔═══════════════════════════════════════════════════════════╗
║  🐸 MEMECOIN SCANNER — [date]                             ║
║  ⚠️ ULTRA-RISQUE — Max 1-2% du portfolio par position     ║
║  DOGE: $X.XXXX (±X%) | SHIB: $X.XXXXXXX (±X%)            ║
║  PEPE: $X.XXXXXXXX (±X%)                                  ║
║  Régime Meme: 🟢 PUMP SEASON / 🟡 SÉLECTIF / 🔴 CALME    ║
╚═══════════════════════════════════════════════════════════╝

🏆 TOP 5 MEMECOINS — POTENTIEL EXPLOSIF

┌─────────────────────────────────────────┐
│ #1 — [SYMBOL] — Score: XX/100 🐸        │
│ Prix: $X.XXXXXXXX | MCap: $XXM          │
│ 24h: +XX.X% | Vol 24h: $XXM (Xх avg)   │
├─────────────────────────────────────────┤
│ 🔥 Hype sociale: XX/30 — [source]      │
│ 📊 Volume surge: XX/25 — [ratio]       │
│ 📈 Pattern: XX/20 — [type]             │
│ 🚀 Catalyseur: XX/15 — [event]         │
│ 🛡️ Sécurité: XX/10 — [plateforme]     │
├─────────────────────────────────────────┤
│ NIVEAUX DEGEN                           │
│ 🟢 Entrée FOMO : $X.XXXXXXXX            │
│ 🟡 Entrée pullback : $X.XXXXXXXX        │
│ 🎯 TP1 (+30%) : $X.XXXXXXXX             │
│ 🎯 TP2 (+80%) : $X.XXXXXXXX             │
│ 🎯 TP3 (+200%) : $X.XXXXXXXX            │
│ 🛑 SL (-15%) : $X.XXXXXXXX              │
│ ⏰ Window : [session optimale]           │
│ 💡 Pourquoi : [1 phrase degen]           │
│ ⚠️ Risque : [1 phrase warning]           │
└─────────────────────────────────────────┘

[Répéter #2 à #5]

📊 TABLEAU RÉCAPITULATIF

| # | Symbol | Score | Prix | 24h% | Vol | TP1 | TP2 | SL | Hype |
|---|--------|-------|------|------|-----|-----|-----|----|------|

🎰 WILDCARDS (#6-#10)
[micro-caps ultra-spéculatifs, 1 phrase chacun]

📌 STRATÉGIE MEME DU JOUR
[Bias global, memes les plus chauds, risques, approche "lottery ticket"]

⚠️⚠️⚠️ AVERTISSEMENT OBLIGATOIRE ⚠️⚠️⚠️
Les memecoins sont des actifs ULTRA-SPÉCULATIFS sans valeur fondamentale.
- Investir UNIQUEMENT de l'argent qu'on est prêt à perdre à 100%
- MAX 1-2% du portfolio TOTAL par position
- Les memes peuvent perdre 80-99% de leur valeur en quelques heures
- Ce n'est PAS un conseil en investissement. C'est une analyse de momentum.
```
