/**
 * Funding-rate research — is crowded positioning a tradeable signal?
 *
 * The hypothesis, which every crypto commentator repeats: when perpetual
 * funding goes extreme, the crowd is offside and price mean-reverts against it.
 * It is orthogonal to price by construction — funding is what leveraged traders
 * PAY, not what the asset did — which is exactly why it is worth testing, since
 * every indicator already in the engine is a transformation of price.
 *
 * Data is Binance USD-M funding history: free, no key, back to 2019.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { alesiaPath } from '../../../utils/paths.js';

const CACHE_DIR = alesiaPath('backtest-cache');

export interface FundingPoint {
  time: number;
  rate: number;
}

/**
 * Page through Binance funding history.
 *
 * Settlements are 8-hourly for the majors, so a full history is a few thousand
 * points — small enough to keep entirely in memory.
 */
export async function fetchFundingHistory(symbol: string, sinceMs: number): Promise<FundingPoint[]> {
  const cacheFile = join(CACHE_DIR, `funding-${symbol}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf-8')) as FundingPoint[];
    if (cached.length > 0) return cached;
  } catch {
    // no cache yet
  }

  const out: FundingPoint[] = [];
  let cursor = sinceMs;
  for (let request = 0; request < 60; request++) {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&limit=1000`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Binance funding returned HTTP ${resp.status} for ${symbol}`);
    const rows = (await resp.json()) as Array<{ fundingTime: number; fundingRate: string }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      const rate = Number(r.fundingRate);
      if (Number.isFinite(rate)) out.push({ time: r.fundingTime, rate });
    }
    cursor = rows[rows.length - 1].fundingTime + 1;
    if (rows.length < 1000) break;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(out), 'utf-8');
  return out;
}

export interface Observation {
  symbol: string;
  time: number;
  /** Standardised against the trailing window only — never the full series. */
  z: number;
  rate: number;
  /** Forward return in percent, keyed by horizon in hours. */
  forward: Record<number, number>;
}

/**
 * Standardise each funding print against its own trailing distribution.
 *
 * A raw rate is not comparable across assets or across regimes: 0.01% is
 * extreme for BTC and unremarkable for a small-cap perp, and the whole level
 * shifted after 2022. The z-score uses ONLY prior settlements, so nothing here
 * knows anything the trader would not have known.
 */
export function buildObservations(
  symbol: string,
  funding: FundingPoint[],
  priceAt: (time: number) => number | null,
  horizonsHours: number[],
  lookback = 90,
): Observation[] {
  const out: Observation[] = [];
  for (let i = lookback; i < funding.length; i++) {
    const window = funding.slice(i - lookback, i).map((f) => f.rate);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    const sd = Math.sqrt(variance);
    if (!(sd > 0)) continue;

    const z = (funding[i].rate - mean) / sd;
    const base = priceAt(funding[i].time);
    if (base === null || base <= 0) continue;

    const forward: Record<number, number> = {};
    let complete = true;
    for (const h of horizonsHours) {
      const later = priceAt(funding[i].time + h * 3_600_000);
      if (later === null || later <= 0) {
        complete = false;
        break;
      }
      forward[h] = ((later - base) / base) * 100;
    }
    if (!complete) continue;

    out.push({ symbol, time: funding[i].time, z, rate: funding[i].rate, forward });
  }
  return out;
}

export interface BinStats {
  label: string;
  n: number;
  meanReturn: number;
  ci95: [number, number];
  hitRate: number;
}

/** Deterministic bootstrap — same generator as the harness, for reproducibility. */
export function bootstrapMean(values: number[], iterations = 2000): [number, number] | null {
  if (values.length < 20) return null;
  let seed = 20260801;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const means: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let k = 0; k < values.length; k++) sum += values[Math.floor(next() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]];
}

export function summarise(label: string, values: number[]): BinStats {
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const ci = bootstrapMean(values) ?? [Number.NaN, Number.NaN];
  return {
    label,
    n: values.length,
    meanReturn: mean,
    ci95: ci,
    hitRate: values.length ? (values.filter((v) => v > 0).length / values.length) * 100 : 0,
  };
}

/**
 * Two-sample bootstrap on the DIFFERENCE in means.
 *
 * Testing a bin's mean against zero answers the wrong question here: crypto
 * rose over 2019-2026, so the unconditional forward return is already
 * significantly positive at every horizon. "Crowded shorts are followed by a
 * positive return" is therefore the null, not a discovery. The only question
 * that matters is whether the bin beats the population it was drawn from.
 */
export function bootstrapDifference(
  sample: number[],
  population: number[],
  iterations = 2000,
): { diff: number; ci95: [number, number] } | null {
  if (sample.length < 20 || population.length < 20) return null;
  let seed = 20260801;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const meanOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const diffs: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let sa = 0;
    for (let k = 0; k < sample.length; k++) sa += sample[Math.floor(next() * sample.length)];
    let sp = 0;
    for (let k = 0; k < population.length; k++) sp += population[Math.floor(next() * population.length)];
    diffs.push(sa / sample.length - sp / population.length);
  }
  diffs.sort((a, b) => a - b);
  return {
    diff: meanOf(sample) - meanOf(population),
    ci95: [diffs[Math.floor(iterations * 0.025)], diffs[Math.floor(iterations * 0.975)]],
  };
}

/**
 * Thin the sample so forward windows do not overlap.
 *
 * Consecutive 8-hourly settlements share most of a 7-day forward return, so the
 * effective sample size is far below the row count and any naive confidence
 * interval is far too narrow. This is the correction that collapsed the COT
 * "signal" in an earlier probe, and it must be applied before believing
 * anything here.
 */
export function nonOverlapping<T extends { time: number }>(rows: T[], horizonHours: number): T[] {
  const spacingMs = horizonHours * 3_600_000;
  const out: T[] = [];
  let lastTime = -Infinity;
  for (const row of rows) {
    if (row.time - lastTime >= spacingMs) {
      out.push(row);
      lastTime = row.time;
    }
  }
  return out;
}
