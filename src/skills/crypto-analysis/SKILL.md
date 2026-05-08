---
name: crypto-analysis
description: Performs a comprehensive cryptocurrency analysis using free Binance data. Triggers when user asks about crypto, Bitcoin, Ethereum, altcoins, crypto analysis, or provides a crypto symbol like "BTC", "ETH", "SOL".
---

# Crypto Analysis Skill — Multi-Dimensional Token Analysis

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→6) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Le rapport DOIT inclure : prix actuel + 24h, MA20/MA50, support/résistance, sentiment, matrice de risque /20, et niveaux d'entrée/sortie. Langue : FRANÇAIS.**

## Workflow Checklist

```
Crypto Analysis Progress:
- [ ] Step 1: Fetch current price and 24h stats from Binance
- [ ] Step 2: Analyze price history and technical levels
- [ ] Step 3: Assess market sentiment via web search
- [ ] Step 4: On-chain & fundamental analysis (if applicable)
- [ ] Step 5: Risk assessment
- [ ] Step 6: Issue verdict with entry/exit levels
```

## Step 1: Current Market Data
Use `binance_price` for the token (append USDT, e.g., BTCUSDT):
- Current price, 24h high/low, 24h volume
- 24h price change %

## Step 2: Technical Analysis
Use `binance_klines` with interval '1d' and limit 90:
- Calculate manually: 20-day and 50-day moving averages from the kline close prices
- Identify the nearest support (recent swing low) and resistance (recent swing high)
- Determine trend: Bullish (price > 50-day MA), Bearish (price < 50-day MA), Neutral (sideways)
- Calculate RSI approximation: Count up-days vs down-days over last 14 candles

## Step 3: Sentiment Analysis
- Call `fear_greed_index` `limit=7` to gauge global crypto sentiment over the last week
- Use `web_search` to search for recent news about the token:
  - Search: "[TOKEN NAME] news last 7 days"
  - Classify overall sentiment: Bullish / Bearish / Neutral
  - Note any major catalysts (ETF approval, partnership, hack, regulatory action)

## Step 4: Fundamental Analysis
- **Source d'autorité MCap rank** : appelle `crypto_market_cap` `limit=100` UNE fois et lis le rang directement. NE PAS deviner et NE PAS faire de `web_search` pour le rang — la donnée est dans la réponse.
- Total Supply vs Circulating Supply : disponibles dans `crypto_market_cap.coins[i]` (`circulatingSupply`, `maxSupply`).
- Pour les enjeux qualitatifs (token unlocks, TVL, revenu protocolaire), utilise `web_search "[TOKEN] tokenomics unlock schedule TVL"`.

## Step 5: Risk Assessment
Score from 1-5 (1 = low risk, 5 = extreme risk):
- **Volatility Risk**: Based on 24h and 30-day price swings
- **Liquidity Risk**: Based on 24h volume relative to market cap
- **Regulatory Risk**: Based on recent regulatory news
- **Concentration Risk**: Top holder concentration (if findable)

## Step 6: Output Format

```
═══════════════════════════════════════════
   ANALYSE CRYPTO — [TOKEN] ([SYMBOL])
   Prix : $XX,XXX | 24h : ±X.X%
   Note : ⭐⭐⭐⭐ | Risque : 🟡 Modéré
   Verdict : 🟢 ACHETER / 🟡 ATTENDRE / 🔴 ÉVITER
═══════════════════════════════════════════

📊 1. DONNÉES DE MARCHÉ (Binance)
   Prix : $XX,XXX | Volume 24h : $XX M
   24h Range : $XX,XXX — $XX,XXX
   Variation 24h : ±X.X%

📈 2. ANALYSE TECHNIQUE
   Tendance : 🟢 Haussière / 🔴 Baissière / 🟡 Neutre
   MA20 : $XX,XXX | MA50 : $XX,XXX
   Support clé : $XX,XXX
   Résistance clé : $XX,XXX
   RSI (14) : XX (Suracheté >70 / Survendu <30)

🌐 3. SENTIMENT MARCHÉ
   Sentiment global : [Bullish/Bearish/Neutral]
   Catalyseurs récents : [list]

🔍 4. FONDAMENTAUX
   Market Cap Rank : #XX
   Supply : XX M / XX M (XX% en circulation)
   Prochains unlocks : [if any]

⚠️ 5. MATRICE DE RISQUE (Score /20)
   Volatilité  : X/5
   Liquidité   : X/5
   Régulation  : X/5
   Concentration : X/5

💰 6. NIVEAUX D'ENTRÉE / SORTIE
   🟢 Entrée agressive : $XX,XXX (support immédiat)
   🟡 Entrée conservatrice : $XX,XXX (support majeur)
   🎯 Take Profit 1 : $XX,XXX (résistance)
   🎯 Take Profit 2 : $XX,XXX (ATH ou résistance majeure)
   🛑 Stop Loss : $XX,XXX (sous le support clé)

📌 CONCLUSION
   [2-3 sentences with clear recommendation]

⚠️ Recherche automatisée, pas un conseil en investissement. La crypto est extrêmement volatile — position sizing conservateur (max 5% par token, 10% pour BTC/ETH).
```
