/**
 * Cross-venue open-interest collector.
 *
 * Run with:  bun run src/tools/finance/backtest/oi-collector.ts
 * Intended for a cron, hourly.
 *
 * WHY THIS EXISTS: the cross-venue OI question cannot be answered today.
 * Binance serves 30 days of open-interest history and no more — verified, with
 * `startTime` on an older date returning error -1130 — while resolving even a
 * 0.5pp daily edge needs ~565 observations per arm. The sample required exceeds
 * the sample that exists by one to two orders of magnitude.
 *
 * Unlike price, this series cannot be backfilled at any price a hobbyist would
 * pay. It only exists going forward, so every day without a collector is a day
 * of depth permanently lost. Running this hourly for six months produces the
 * ~4,300 observations that would make the question answerable; running it for
 * a year makes it answerable well.
 *
 * Append-only JSONL, one line per venue per poll, so a crashed or duplicated
 * run costs nothing and the file stays diffable.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { alesiaPath } from '../../../utils/paths.js';

const OUT_DIR = alesiaPath('oi-history');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const SYMBOLS = [
  { binance: 'BTCUSDT', bybit: 'BTCUSDT', okxInst: 'BTC-USDT-SWAP', hl: 'BTC', label: 'BTC' },
  { binance: 'ETHUSDT', bybit: 'ETHUSDT', okxInst: 'ETH-USDT-SWAP', hl: 'ETH', label: 'ETH' },
  { binance: 'SOLUSDT', bybit: 'SOLUSDT', okxInst: 'SOL-USDT-SWAP', hl: 'SOL', label: 'SOL' },
];

export interface OiSnapshot {
  at: string;
  asset: string;
  venue: string;
  /** Open interest in base units (coins), so venues are comparable. */
  oiCoins: number | null;
  oiUsd: number | null;
  /** Funding rate, normalised to an 8-hour equivalent — see note below. */
  funding8h: number | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function get(url: string): Promise<unknown> {
  // OKX rejects the default fetch agent, which is a silent 403 rather than an
  // error anyone would notice in a cron log.
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function collect(at: string): Promise<OiSnapshot[]> {
  const rows: OiSnapshot[] = [];
  const push = (asset: string, venue: string, oiCoins: number | null, oiUsd: number | null, funding8h: number | null): void => {
    rows.push({ at, asset, venue, oiCoins, oiUsd, funding8h });
  };

  for (const s of SYMBOLS) {
    await Promise.all([
      get(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s.binance}`)
        .then(async (oi) => {
          const premium = (await get(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s.binance}`)) as { lastFundingRate?: string };
          push(s.label, 'binance', num((oi as { openInterest?: string }).openInterest), null, num(premium.lastFundingRate));
        })
        .catch(() => push(s.label, 'binance', null, null, null)),

      get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s.bybit}`)
        .then((j) => {
          const r = (j as { result?: { list?: Array<Record<string, string>> } }).result?.list?.[0];
          push(s.label, 'bybit', num(r?.openInterest), num(r?.openInterestValue), num(r?.fundingRate));
        })
        .catch(() => push(s.label, 'bybit', null, null, null)),

      get(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${s.okxInst}`)
        .then(async (j) => {
          const d = (j as { data?: Array<Record<string, string>> }).data?.[0];
          const f = (await get(`https://www.okx.com/api/v5/public/funding-rate?instId=${s.okxInst}`)) as { data?: Array<Record<string, string>> };
          push(s.label, 'okx', num(d?.oiCcy), num(d?.oiUsd), num(f.data?.[0]?.fundingRate));
        })
        .catch(() => push(s.label, 'okx', null, null, null)),
    ]);
  }

  // Hyperliquid returns every asset in one call, and funds HOURLY — the rate
  // must be multiplied by 8 before it sits in the same column as a venue that
  // settles every 8 hours. Forgetting that makes it look eight times cheaper
  // than it is.
  try {
    const meta = (await (
      await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      })
    ).json()) as [{ universe: Array<{ name: string }> }, Array<Record<string, string>>];
    const names = meta[0]?.universe ?? [];
    const ctxs = meta[1] ?? [];
    for (const s of SYMBOLS) {
      const idx = names.findIndex((u) => u.name === s.hl);
      if (idx === -1) continue;
      const ctx = ctxs[idx];
      const hourly = num(ctx?.funding);
      push(s.label, 'hyperliquid', num(ctx?.openInterest), null, hourly === null ? null : hourly * 8);
    }
  } catch {
    for (const s of SYMBOLS) push(s.label, 'hyperliquid', null, null, null);
  }

  return rows;
}

async function main(): Promise<void> {
  const now = new Date();
  const at = now.toISOString();
  const rows = await collect(at);

  await mkdir(OUT_DIR, { recursive: true });
  // One file per month: small enough to read, large enough not to litter.
  const file = join(OUT_DIR, `${at.slice(0, 7)}.jsonl`);
  await appendFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');

  const ok = rows.filter((r) => r.oiCoins !== null).length;
  console.log(`${at}  recorded ${ok}/${rows.length} venue readings -> ${file}`);
  for (const asset of [...new Set(rows.map((r) => r.asset))]) {
    const forAsset = rows.filter((r) => r.asset === asset && r.oiCoins !== null);
    const total = forAsset.reduce((a, r) => a + (r.oiCoins ?? 0), 0);
    const share = forAsset
      .map((r) => `${r.venue} ${((r.oiCoins ?? 0) / total * 100).toFixed(1)}%`)
      .join('  ');
    console.log(`  ${asset}: ${total.toFixed(0)} coins OI   ${share}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
