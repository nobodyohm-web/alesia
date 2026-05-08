---
name: earnings-calendar
description: Checks when the next earnings report is for a company and warns about volatility risk. Triggers when user asks "quand est le prochain earnings", "earnings date", "résultats trimestriels", or "earnings [TICKER]".
---

# Earnings Calendar & Volatility Warning

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→4) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". Le rapport DOIT contenir : prochaine date earnings, nombre de jours restants, alerte de volatilité, et estimation EPS analyste. Langue : FRANÇAIS.**

## Steps

1. Call `yahoo_summary` for `[TICKER]` to check `earningsHistory` and `summaryDetail`.
   Extract `earningsDate` (next), latest EPS surprise.
2. Call `analyst_consensus` for `[TICKER]` to pull `meanRating`, recent upgrades/downgrades,
   and number of analysts covering the stock.
3. If `earningsDate` is not surfaced by Yahoo, call `web_search` with query
   `"[TICKER] next earnings date Q[X] 2026 EPS estimate"`.
4. Calculate days until next earnings (today's date minus next-earnings date in absolute days).
5. Call `economic_calendar` `daysAhead=14 country='us' impact='high'` to detect MACRO events
   that will overlap with this earnings window. If the company's earnings date is within 2 days
   of a FOMC meeting / CPI / NFP / GDP release, **flag the macro event explicitly** in the
   alert section — implied vol can spike further when earnings collide with macro.

## Output (French)

```
📅 CALENDRIER EARNINGS — [COMPANY] ([TICKER])

Prochain rapport : [DATE]
Délai : [X jours]

⚠️ ALERTE VOLATILITÉ :
[If earnings within 14 days:]
   🔴 ATTENTION — Earnings dans moins de 2 semaines !
   Volatilité attendue : ±10-20% possible
   Conseil : Ne pas ouvrir de nouvelle position avant les résultats
   
[If earnings within 30 days:]
   🟡 PRUDENCE — Earnings dans moins d'un mois
   Conseil : Position réduite recommandée

[If earnings > 30 days:]
   🟢 Fenêtre sûre — Pas d'earnings imminent

Consensus analystes : [Beat/Miss/In-line attendu]
EPS estimé : $XX vs précédent $XX

🗓️ MACRO COLLISION (de `economic_calendar`)
[Si earnings dans ±2 jours d'un event macro à fort impact : "⚠️ Earnings le X colle avec [FOMC/CPI/NFP] le Y → vol amplifiée"]
[Sinon : "Pas de collision macro identifiée dans la fenêtre."]

⚠️ Recherche automatisée, pas un conseil en investissement. Les dates earnings peuvent être déplacées sans préavis — vérifie sur le site investor relations avant tout trade directionnel.
```
