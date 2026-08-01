/**
 * Treasury Yield Curve Tool — Official US Treasury par yield curves.
 * Free, no API key, published by home.treasury.gov each business day.
 *
 * Supplies the risk-free rate and the real (TIPS) curve, so a DCF can be
 * anchored on the actual discount rate instead of a number the model recalls.
 * The nominal-minus-real spread gives market-implied inflation (breakeven),
 * and the 2s10s / 3m10y spreads give the recession signal.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch, memoize } from '../../utils/retry.js';
import { TTL_6H } from './utils.js';

const BASE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv';

export const TREASURY_YIELDS_DESCRIPTION = `
Fetches the official US Treasury yield curve (free, no API key, primary source).

Returns for the most recent business days:
- **Nominal par yields** across the whole curve (1 month to 30 years)
- **Real yields** from TIPS (5 to 30 years)
- **Breakeven inflation** = nominal minus real, per maturity
- **Curve spreads**: 2s10s and 3m10y, with the inversion flag

Use it for: the risk-free rate in any DCF or WACC, the cash/bond alternative when
judging an equity's risk premium, market-implied inflation, and yield-curve regime
(inverted = historical recession signal). Never state a Treasury yield from memory.
`.trim();

const TreasuryYieldsSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(5)
    .describe('Number of recent business days to return (1-30). Defaults to 5.'),
  includeReal: z
    .boolean()
    .default(true)
    .describe('Include the TIPS real yield curve and computed breakeven inflation.'),
});

/** Canonical maturity keys, ordered short to long. */
const MATURITY_ORDER = ['1M', '1.5M', '2M', '3M', '4M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];

/**
 * Normalise Treasury's inconsistent column headers ("1 Mo", "10 Yr", "10 YR",
 * "1.5 Month") into a single key set so nominal and real curves can be joined.
 */
export function normaliseMaturity(header: string): string | null {
  const h = header.trim().replace(/"/g, '').toUpperCase();
  const m = h.match(/^([\d.]+)\s*(MO|MONTH|YR|YEAR)S?$/);
  if (!m) return null;
  return `${m[1]}${m[2].startsWith('M') ? 'M' : 'Y'}`;
}

/** Minimal CSV parser handling the quoted headers Treasury emits. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  return { headers: split(lines[0] ?? ''), rows: lines.slice(1).map(split) };
}

type CurveRow = { date: string; yields: Record<string, number> };

async function fetchCurve(type: 'daily_treasury_yield_curve' | 'daily_treasury_real_yield_curve', year: number): Promise<CurveRow[]> {
  const url = `${BASE}/${year}/all?type=${type}&field_tdr_date_value=${year}&_format=csv`;
  const resp = await safeFetch(url, {
    method: 'GET',
    // Treasury sits behind a CDN that drops requests without a browser UA.
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Alesia/1.0)', Accept: 'text/csv,*/*' },
  });
  if (!resp.ok) throw new Error(`Treasury returned HTTP ${resp.status} for ${type}`);

  const { headers, rows } = parseCsv(await resp.text());
  const cols = headers.map(normaliseMaturity);

  return rows
    .map((cells) => {
      const yields: Record<string, number> = {};
      cells.forEach((cell, i) => {
        const key = cols[i];
        const value = Number.parseFloat(cell);
        if (key && Number.isFinite(value)) yields[key] = value;
      });
      return { date: cells[0] ?? '', yields };
    })
    .filter((r) => r.date && Object.keys(r.yields).length > 0);
}

/** Treasury dates are MM/DD/YYYY; sort newest first without relying on locale parsing. */
export function toIso(usDate: string): string {
  const [m, d, y] = usDate.split('/');
  return y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : usDate;
}

export const treasuryYieldsTool = new DynamicStructuredTool({
  name: 'treasury_yields',
  description:
    'Official US Treasury yield curve (free, no key): nominal par yields 1M-30Y, TIPS real yields, breakeven inflation, and 2s10s / 3m10y spreads with inversion flag. Use for the risk-free rate in any valuation.',
  schema: TreasuryYieldsSchema,
  func: async (input) => {
    const sources = ['https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve'];
    try {
      return await memoize(`treasury_yields:${input.days}:${input.includeReal}`, TTL_6H, async () => {
        const year = new Date().getUTCFullYear();

        let nominal = await fetchCurve('daily_treasury_yield_curve', year);
        // Early January: the new year's file can be empty until the first
        // business day publishes, so fall back to the previous year.
        if (nominal.length === 0) {
          nominal = await fetchCurve('daily_treasury_yield_curve', year - 1);
        }
        if (nominal.length === 0) {
          return formatToolResult({ error: 'Treasury returned no yield curve data' }, sources);
        }

        nominal.sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)));
        const recent = nominal.slice(0, input.days);

        let real: CurveRow[] = [];
        if (input.includeReal) {
          try {
            real = await fetchCurve('daily_treasury_real_yield_curve', year);
            if (real.length === 0) real = await fetchCurve('daily_treasury_real_yield_curve', year - 1);
            real.sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)));
          } catch {
            // The real curve is supplementary — a failure must not lose the nominal one.
          }
        }
        const realByDate = new Map(real.map((r) => [toIso(r.date), r.yields]));

        const curve = recent.map((row) => {
          const iso = toIso(row.date);
          const realYields = realByDate.get(iso);
          const breakeven: Record<string, number> = {};
          if (realYields) {
            for (const [maturity, realRate] of Object.entries(realYields)) {
              const nom = row.yields[maturity];
              if (Number.isFinite(nom)) breakeven[maturity] = Number((nom - realRate).toFixed(2));
            }
          }
          return {
            date: iso,
            nominal: Object.fromEntries(
              MATURITY_ORDER.filter((m) => m in row.yields).map((m) => [m, row.yields[m]]),
            ),
            ...(realYields ? { real: realYields, breakeven } : {}),
          };
        });

        const latest = curve[0];
        const y10 = latest.nominal['10Y'];
        const y2 = latest.nominal['2Y'];
        const m3 = latest.nominal['3M'];
        const spread2s10s = Number.isFinite(y10) && Number.isFinite(y2) ? Number((y10 - y2).toFixed(2)) : null;
        const spread3m10y = Number.isFinite(y10) && Number.isFinite(m3) ? Number((y10 - m3).toFixed(2)) : null;

        return formatToolResult(
          {
            asOf: latest.date,
            riskFreeRate10Y: y10 ?? null,
            spreads: {
              '2s10s': spread2s10s,
              '3m10y': spread3m10y,
              inverted: spread2s10s !== null ? spread2s10s < 0 : null,
              interpretation:
                spread2s10s === null
                  ? null
                  : spread2s10s < 0
                    ? 'Curve inverted (2s10s negative) — historically a recession signal.'
                    : 'Curve upward sloping.',
            },
            breakeven10Y: latest.breakeven?.['10Y'] ?? null,
            curve,
          },
          sources,
        );
      });
    } catch (error) {
      return formatToolResult(
        { error: `Treasury yields fetch failed: ${error instanceof Error ? error.message : String(error)}` },
        sources,
      );
    }
  },
});
