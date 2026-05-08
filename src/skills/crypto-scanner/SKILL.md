---
name: crypto-scanner
description: Ultra-aggressive crypto opportunity scanner. Finds the highest-potential cryptocurrencies for trading TODAY using Binance data. Triggers on "/crypto", "crypto scanner", "crypto opportunities", "best crypto today", "meilleure crypto", "crypto du jour".
---

# 🪙 CRYPTO SCANNER — Chasseur d'Opportunités Crypto

**INSTRUCTIONS STRICTES : Exécute TOUTES les phases (1→6) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Langue : FRANÇAIS. Données Binance (FREE) + web search.**

Mission : identifier les 5-10 meilleures cryptos à FORT potentiel pour aujourd'hui. Multi-timeframe, multi-source.

## PHASE 1 — MARKET STATE (contexte global)

En parallèle :
1. `binance_price` symbol='BTCUSDT' — BTC comme baromètre
2. `binance_price` symbol='ETHUSDT' — ETH comme baromètre
3. `binance_top_movers` direction='gainers' limit=20 — top gainers 24h
4. `binance_top_movers` direction='losers' limit=10 — top losers (pour les rebonds)
5. `fear_greed_index` `limit=7` — sentiment global crypto + tendance 7 jours
6. `crypto_market_cap` `limit=100` — top 100 cryptos par MCap (référence pour ranking + filtrage des micro-caps illiquides)
7. `web_search` "crypto news today catalyst token unlock"

**Régime crypto :**
- BTC > MA50 + Fear & Greed > 50 → 🟢 BULL MODE — acheter les breakouts
- BTC < MA50 + Fear & Greed < 30 → 🔴 BEAR MODE — acheter les rebonds sur support
- Entre les deux → 🟡 RANGE — scalper les ranges, positions plus petites

## PHASE 2 — SCANNING MULTI-ANGLE

### Angle 1 : Momentum pur (top movers)
Des 20 top gainers récupérés en Phase 1, filtrer :
- Volume 24h > $10M (liquidité suffisante)
- Variation > +5% mais < +50% (pas déjà exhausté)
- Pas un stablecoin (ignorer USDC, USDT, DAI, BUSD, TUSD, FDUSD)

### Angle 2 : Volume anormal
`web_search` "crypto unusual volume today Binance"
`web_search` "altcoins volume spike today"

### Angle 3 : Catalyseurs
`web_search` "crypto token unlock schedule this week"
`web_search` "crypto partnerships announcements today"
`web_search` "crypto listing Binance Coinbase new"

### Angle 4 : Analyse technique
Pour les 10 meilleurs candidats des angles 1-3 :
`binance_klines` symbol=[PAIR] interval='4h' limit=50 — pour MA20, MA50, support/résistance
`binance_klines` symbol=[PAIR] interval='1d' limit=30 — pour tendance macro

### Angle 5 : Social/Sentiment
`x_search` "crypto gem today breakout signal" (si disponible)
`web_search` "trending crypto on social media today"

## PHASE 3 — ANALYSE TECHNIQUE APPROFONDIE

Pour CHAQUE crypto du top 10, calcule :

**Indicateurs obligatoires :**
- MA20 et MA50 (à partir des klines 1d)
- Position relative : prix vs MA20 vs MA50
- Support : dernier swing low sur klines 4h
- Résistance : dernier swing high sur klines 4h
- RSI approximatif : (jours en hausse / 14) × 100 sur les 14 derniers jours
- Volume trend : volume moyen 7j vs volume moyen 30j (ratio)
- Pattern : breakout, pullback, range, dip, moon

**Score Technique /40 :**
| Signal | Points |
|--------|--------|
| Prix > MA20 > MA50 (full bullish) | 12 |
| Prix > MA20 mais < MA50 | 7 |
| Prix < MA20 < MA50 (bearish) | 2 |
| RSI 40-65 (zone d'achat) | 8 |
| RSI > 70 (suracheté) | 2 |
| RSI < 30 (survendu, possible rebond) | 6 |
| Volume ratio > 2x (surge) | 10 |
| Volume ratio 1.2-2x (en hausse) | 6 |
| Volume ratio < 1x (déclinant) | 2 |
| Near support (< 5% du support) | 10 |
| Near résistance (< 3% de la résistance) | 3 |

## PHASE 4 — SCORING & CLASSEMENT (100 pts)

| Critère | Max | Comment |
|---------|-----|---------|
| Technique | 40 | Voir grille Phase 3 |
| Momentum 24h | 20 | +5-10%=15, +10-20%=20, +20-50%=12 (surchauffe), <5%=8 |
| Catalyseur | 20 | Listing=15, Partnership=12, Unlock (négatif)=-5, News positive=10 |
| Liquidité | 10 | Vol>$100M=10, >$50M=8, >$10M=5, <$10M=2 |
| Fondamentaux | 10 | Top 50 MCap=10, Top 100=7, Top 300=4, Hors top 300=2 (rank obtenu directement de `crypto_market_cap` Phase 1, ne PAS deviner) |

## PHASE 5 — NIVEAUX DE TRADING ULTRA-PRÉCIS

Pour le **TOP 5**, calcule :

### Niveaux d'entrée
- 🟢 **Entrée agressive** : prix actuel (market order)
- 🟡 **Entrée limit** : premier support (MA20 ou -3% du prix)
- 🔴 **Entrée deep** : support majeur (MA50 ou swing low)

### Take Profit
- 🎯 **TP1 (scalp, 1-24h)** : prochaine résistance ou +5-8%
- 🎯 **TP2 (swing, 2-7j)** : résistance majeure ou +15-25%
- 🎯 **TP3 (hold, 2-4 sem)** : cible technique long terme ou +30-60%

### Stop Loss & Gestion du risque
- 🛑 **Stop Loss** : sous le support clé (-5-8% max du prix d'entrée)
- ⚖️ **Risk/Reward minimum** : 2:1 obligatoire
- 💰 **Taille de position** : max 5% du portfolio par crypto (10% pour BTC/ETH)

### Timing
- ⏰ **Crypto 24/7** : mais les volumes pic sont 14h-18h UTC (ouverture US) et 02h-04h UTC (Asie)
- 📅 **Éviter** : les dimanches soir (faible liquidité), les jours de FOMC (corrélation BTC-macro)

## PHASE 6 — OUTPUT

```
╔═══════════════════════════════════════════════════════════╗
║  🪙 CRYPTO SCANNER — [date]                               ║
║  BTC: $XX,XXX (±X.X%) | ETH: $X,XXX (±X.X%)              ║
║  Régime: 🟢/🟡/🔴 [BULL/RANGE/BEAR]                       ║
║  Fear & Greed: XX/100 — [Extrême Peur / Peur / Neutre /   ║
║                           Avidité / Extrême Avidité]       ║
║  Cryptos scannées: XX | Top 5 présentés                    ║
╚═══════════════════════════════════════════════════════════╝

🏆 TOP 5 CRYPTOS DU JOUR

┌─────────────────────────────────────────┐
│ #1 — [SYMBOL] — Score: XX/100           │
│ Prix: $XX.XXXX | MCap Rank: #XX         │
│ 24h: ±XX.X% | Vol 24h: $XXM             │
├─────────────────────────────────────────┤
│ 📈 Technique: XX/40 — [tendance]        │
│ 🔥 Momentum: XX/20 — [signal]          │
│ 🚀 Catalyseur: XX/20 — [event]         │
│ 💧 Liquidité: XX/10 — [vol]            │
│ 🏛️ Fondamentaux: XX/10                 │
├─────────────────────────────────────────┤
│ NIVEAUX DE TRADING                      │
│ 🟢 Entrée agressive : $XX.XXXX          │
│ 🟡 Entrée limit : $XX.XXXX              │
│ 🎯 TP1 (24h) : $XX.XXXX (+X.X%)        │
│ 🎯 TP2 (7j) : $XX.XXXX (+XX.X%)        │
│ 🎯 TP3 (1mois) : $XX.XXXX (+XX.X%)     │
│ 🛑 SL : $XX.XXXX (-X.X%)               │
│ ⚖️ R/R : 1:X.X                          │
│ ⏰ Timing : [session optimale]           │
│ 💡 Thèse : [1 phrase]                   │
└─────────────────────────────────────────┘

[Répéter #2 à #5]

📊 TABLEAU RÉCAPITULATIF

| # | Symbol | Score | Prix | 24h | TP1 | TP2 | SL | R/R | Signal |
|---|--------|-------|------|-----|-----|-----|----|-----|--------|

🔥 MENTIONS HONORABLES (#6-#10)
[symbol, score, signal clé, 1 phrase]

📌 STRATÉGIE CRYPTO DU JOUR
[Bias (long/short/neutre), corrélation BTC, secteurs crypto chauds (DeFi/AI/L2/Gaming), risques]

⚠️ Les marchés crypto sont extrêmement volatils. Position sizing conservateur. Pas un conseil en investissement.
```
