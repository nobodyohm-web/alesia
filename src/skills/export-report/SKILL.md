---
name: export-report
description: Saves the latest analysis report to a markdown file under .alesia/reports/. Triggers on "exporte", "export", "sauvegarde", "save report", or "PDF" after a report has just been delivered.
---

# Export Report — Persist the latest analysis

**INSTRUCTIONS STRICTES : Exécute TOUTES les étapes (1→6) sans interruption. Ne demande JAMAIS à l'utilisateur "comment procéder". COPIE le rapport existant verbatim — NE LE RÉ-GÉNÈRE JAMAIS. Si aucun rapport n'a été produit dans la conversation, dis-le en une phrase et stoppe. Langue : FRANÇAIS.**

Saves the most recent report (master-analysis, sector-comparison, macro-radar, etc.) as a Markdown file inside `.alesia/reports/` so the user can keep, share, or convert it to PDF later.

## Steps

1. Identify the report just produced in this conversation. Pull the EXACT text — do not regenerate or rewrite it. Include the box header, all sections, and the disclaimer.
2. Determine the ticker (or topic) the report is about:
   - Stock report → ticker like `AAPL`, `FLY`, `BTC`
   - Macro report → use `MACRO`
   - Portfolio report → use `PORTFOLIO`
   - Comparison report → use `[TICKER1]_vs_[TICKER2]`
3. Build the filename: `[TICKER]_[YYYY-MM-DD].md` (today's date in ISO format).
4. Build the full path: `.alesia/reports/[FILENAME]`.
5. Call `write_file` with:
   - `path`: the full path from step 4
   - `content`: a Markdown document containing:
     - YAML frontmatter (`ticker`, `date`, `type`, `verdict` if available)
     - The full report text
     - A footer with the source URLs cited during the analysis
6. Confirm to the user in ONE sentence: filename, path, and a hint that `pandoc [file].md -o [file].pdf` can convert it to PDF.

## Example output structure for the file

```markdown
---
ticker: AAPL
date: 2026-05-02
type: master-analysis
verdict: ACHETER
---

# RAPPORT D'ANALYSE — Apple Inc. (AAPL)

[full report body verbatim]

---

## Sources
- https://finance.yahoo.com/quote/AAPL
- https://www.sec.gov/...
```

## Confirmation message (French)

```
✅ Rapport sauvegardé : .alesia/reports/[FILENAME]
   Pour convertir en PDF : pandoc [path] -o [path:.pdf]
```

⚠️ Le rapport sauvegardé reflète l'analyse au moment de l'export. Les marchés évoluent — l'utiliser comme référence historique, pas comme conseil opérationnel actuel.

## Rules

- NEVER regenerate the report — copy the exact text already shown to the user.
- If no report has been produced in this conversation, reply: "Aucun rapport à exporter — lance d'abord une analyse."
- If `write_file` fails (permission denied, disk full), surface the error verbatim so the user can fix it.
- Do NOT create the `.alesia/reports/` directory manually — `write_file` handles parent directories.
