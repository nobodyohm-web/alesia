export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'search', description: '🔥 Scan best stock opportunities today' },
  { name: 'crypto', description: '🪙 Scan best crypto opportunities today' },
  { name: 'memecoin', description: '🐸 Scan best memecoin moonshots today' },
  { name: 'macro', description: '📊 Macro radar — Fed, VIX, inflation, sentiment' },
  { name: 'ipo', description: '🚀 IPO scanner — upcoming and recent IPOs' },
  { name: 'fear', description: '😱 Crypto Fear & Greed Index' },
  { name: 'sentiment', description: '📡 News & social sentiment for a ticker (e.g. /sentiment AAPL)' },
  { name: 'model', description: 'Switch LLM provider and model' },
  { name: 'rules', description: 'Show your research rules' },
  { name: 'clear', description: 'Clear the conversation' },
  { name: 'memory', description: 'Show what Alesia remembers about you' },
  { name: 'heartbeat', description: 'Show your heartbeat monitoring checklist' },
  { name: 'history', description: 'Show recent conversation summaries' },
  { name: 'help', description: 'Show keyboard shortcuts and tips' },
];

/**
 * Filter commands matching the current input.
 * Input should start with "/". Bare "/" returns all commands.
 */
export function matchCommands(input: string): SlashCommand[] {
  const query = input.slice(1).toLowerCase();
  if (query === '') return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(query));
}
