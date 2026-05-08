import { DynamicStructuredTool } from '@langchain/core/tools';
import { dirname, resolve } from 'path';
import { z } from 'zod';
import { getSkill, discoverSkills } from '../skills/index.js';

/**
 * Rich description for the skill tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const SKILL_TOOL_DESCRIPTION = `
Execute a skill to get specialized instructions for complex tasks.

## When to Use

- When the user's query matches an available skill's description
- For complex workflows that benefit from structured guidance (e.g., DCF valuation, financial reports)
- When you need step-by-step instructions for a specialized task

## When NOT to Use

- For simple queries that don't require specialized workflows
- When no available skill matches the task
- If you've already invoked the skill for this query (don't invoke twice)

## Usage Notes

- Invoke the skill IMMEDIATELY when relevant, as your first action
- The skill returns instructions that you should follow to complete the task
- Use the skill name exactly as listed in Available Skills
- Pass any relevant arguments (like ticker symbols) via the args parameter
`.trim();

/**
 * Skill invocation tool.
 * Loads and returns skill instructions for the agent to follow.
 */
export const skillTool = new DynamicStructuredTool({
  name: 'skill',
  description: 'Execute a skill to get specialized instructions for a task. Returns instructions to follow.',
  schema: z.object({
    skill: z.string().describe('Name of the skill to invoke (e.g., "dcf")'),
    args: z.string().optional().describe('Optional arguments for the skill (e.g., ticker symbol)'),
  }),
  func: async ({ skill, args }) => {
    const skillDef = getSkill(skill);

    if (!skillDef) {
      const available = discoverSkills().map((s) => s.name).join(', ');
      return `Error: Skill "${skill}" not found. Available skills: ${available || 'none'}`;
    }

    // Return instructions with optional args context
    let result = `## Skill: ${skillDef.name}\n\n`;
    
    if (args) {
      result += `**Arguments provided:** ${args}\n\n`;
    }
    
    // Resolve relative markdown links to absolute paths so the agent's
    // read_file tool can find referenced files (e.g., sector-wacc.md).
    const skillDir = dirname(skillDef.path);
    const resolved = skillDef.instructions.replace(
      /\[([^\]]+)\]\(([^)]+\.md)\)/g,
      (_match, label, relPath) => {
        if (relPath.startsWith('/') || relPath.startsWith('http')) return _match;
        return `[${label}](${resolve(skillDir, relPath)})`;
      },
    );

    // Build a forceful preamble that smaller models (gemma4, llama) can't ignore
    result += `═══════════════════════════════════════════════════════════\n`;
    result += `⚠️ MANDATORY EXECUTION PROTOCOL — READ BEFORE DOING ANYTHING\n`;
    result += `═══════════════════════════════════════════════════════════\n\n`;

    if (skillDef.name === 'master-analysis') {
      result += `STEP 1: Call these tools IN THIS EXACT ORDER:\n`;
      result += `  1. yahoo_summary(ticker="${args || '[TICKER]'}")\n`;
      result += `  2. yahoo_historical(ticker="${args || '[TICKER]'}", period="1y", interval="1d")\n`;
      result += `  3. rss_intelligence(query="${args || '[TICKER]'}", mode="company")\n`;
      result += `  4. read_filings(ticker="${args || '[TICKER]'}") — if error, use web_search("[TICKER] 10-K risk factors")\n\n`;
      result += `STEP 2: After ALL 4 tools, generate the report using THIS EXACT FORMAT:\n\n`;
      result += `╔═══════════════════════════════════════════════════════════╗\n`;
      result += `║  RAPPORT D'ANALYSE — [COMPANY] ([TICKER])                 ║\n`;
      result += `║  Date : [today]                                            ║\n`;
      result += `║  Profil : 🚀/📈/🏛️ [STARTUP/CROISSANCE/MATURE]           ║\n`;
      result += `║  Score : XX/100 — ⭐⭐⭐⭐                                 ║\n`;
      result += `║  Verdict : 🟢 ACHETER / 🟡 ATTENDRE / 🔴 ÉVITER          ║\n`;
      result += `╚═══════════════════════════════════════════════════════════╝\n\n`;
      result += `Then include these 7 sections IN ORDER:\n`;
      result += `  🔍 PROFIL — maturity classification with justification\n`;
      result += `  📊 1. FINANCIERS CLÉS — 3-year table (Revenue, Margins, FCF, EPS)\n`;
      result += `  📡 2. VEILLE TEMPS RÉEL — Top RSS items + sentiment score\n`;
      result += `  ⚠️ 3. RISQUE MAJEUR (SEC) — #1 risk from filings\n`;
      result += `  🧬 4. SCORING ADAPTATIF (XX/100) — Factor-by-factor scoring with chain-of-thought\n`;
      result += `  ⚖️ 5. VALORISATION — DCF or P/S adapted to maturity\n`;
      result += `  💰 6. PRIX D'ENTRÉE (Trade Republic 🇪🇺) — USD + EUR prices\n`;
      result += `  📌 7. CONCLUSION — Why buy/avoid, catalysts, 1-year backtest\n\n`;
      result += `Stars: 80-100=⭐⭐⭐⭐⭐ PÉPITE | 65-79=⭐⭐⭐⭐ SOLIDE | 50-64=⭐⭐⭐ CORRECT | 35-49=⭐⭐ FRAGILE | 0-34=⭐ DANGER\n\n`;
      result += `FORBIDDEN: Do NOT use a different format. Do NOT skip the ╔═══ header. Do NOT skip the Score or Stars.\n\n`;
    } else {
      result += `- Execute ALL phases below IN ORDER. Do NOT skip any phase.\n`;
      result += `- Call EVERY tool specified in each phase. Do NOT stop after the first tool call.\n`;
      result += `- Do NOT ask the user for confirmation or "how to proceed". Execute autonomously.\n`;
      result += `- Output MUST follow the exact OUTPUT template at the end. No freestyle.\n`;
      result += `- Language: FRENCH (mandatory).\n\n`;
    }

    result += resolved;

    return result;
  },
});
