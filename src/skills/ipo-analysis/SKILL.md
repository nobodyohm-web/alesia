---
name: ipo-scanner
description: Scans for the most promising upcoming and recent IPOs, ranks them, and presents the top opportunities. Triggers when user types "IPO", "ipo", "nouvelles introductions", "prochaines IPO", "upcoming IPOs", or asks about new market listings.
---

# IPO Scanner — Find the Most Promising IPOs

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→4) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Présente le Top 5 classé par score décroissant avec disponibilité Trade Republic. Langue : FRANÇAIS.**

When the user types "IPO", execute this full workflow to find and rank the best upcoming IPO opportunities. The user trades on Trade Republic (European broker), so flag whether each IPO is likely available there.

## Step 1: Gather IPO Data
Use `ipo_tracker` to fetch recent S-1 filings and Nasdaq IPO calendar data.
Call `rss_intelligence` with query="upcoming IPO 2026", mode='ipo' for latest IPO news and S-1 filings.
Then use `web_search` with query: "most promising upcoming IPOs 2026"

## Step 2: Build the IPO List
For each IPO found (aim for 5-10 companies), gather:
- Company name & ticker
- IPO date (or expected date)
- IPO price (or expected price range)
- Exchange (NYSE / Nasdaq)
- Sector / Industry
- Revenue (if available from S-1)
- Key selling point (what makes this company special?)

## Step 3: Score Each IPO (0-10 scale)
Rate each IPO on these criteria:

| Criterion | Max Points |
|-----------|------------|
| Revenue traction (growing revenue = better) | 3 |
| Market opportunity (large TAM = better) | 2 |
| Competitive moat (unique tech/brand = better) | 2 |
| Underwriter quality (Goldman/Morgan = better) | 1 |
| Valuation attractiveness (reasonable P/S = better) | 2 |

## Step 4: Rank and Present

Sort IPOs by score (highest first) and present the **Top 5 Most Promising**.

## Output Format (Always in French)

```
╔═══════════════════════════════════════════════════╗
║           🚀 SCANNER IPO — TOP OPPORTUNITÉS       ║
║           Date : [today]                           ║
╚═══════════════════════════════════════════════════╝

🥇 #1 — [COMPANY] ([TICKER]) — Score : X/10
   📅 Date IPO : [date] | 💰 Prix : $XX
   🏛️ Exchange : Nasdaq | 🏭 Secteur : [sector]
   📈 Revenus : $XX M (croissance XX%)
   ✨ Point fort : [what makes it special]
   🇪🇺 Trade Republic : ✅ Disponible / ❓ À vérifier
   ──────────────────────────────────

🥈 #2 — [COMPANY] ([TICKER]) — Score : X/10
   [same format]

🥉 #3 — [COMPANY] ([TICKER]) — Score : X/10
   [same format]

#4 — [COMPANY] ([TICKER]) — Score : X/10
   [same format]

#5 — [COMPANY] ([TICKER]) — Score : X/10
   [same format]

──────────────────────────────────────────

💡 CONSEIL : Pour une analyse approfondie d'une de ces IPO,
tapez son ticker (ex: "FLY") pour obtenir le rapport complet
avec scoring MIT et prix d'entrée optimal.

⚠️ Avertissement : Les IPOs sont par nature très volatiles.
Ne jamais investir plus de 5% de son portefeuille dans une seule IPO.
```

## Important Rules
- If no upcoming IPOs are found via ipo_tracker, rely entirely on web_search
- Always mention whether the stock might be available on Trade Republic
- Prioritize IPOs in sectors with strong growth: tech, space, AI, biotech, clean energy
- Flag any red flags: insider-heavy selling, no revenue, extreme valuation
