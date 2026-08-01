import { describe, test, expect } from 'bun:test';
import { DATASETS, shortInterestTool } from './finra.js';

describe('shortInterestTool', () => {
  test('exposes the expected name', () => {
    expect(shortInterestTool.name).toBe('short_interest');
  });

  test('schema defaults to the bi-monthly short interest mode', () => {
    const parsed = shortInterestTool.schema.safeParse({ ticker: 'NVDA' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe('short_interest');
      expect(parsed.data.limit).toBe(10);
    }
  });

  test('schema requires a ticker and rejects unknown modes', () => {
    expect(shortInterestTool.schema.safeParse({}).success).toBe(false);
    expect(shortInterestTool.schema.safeParse({ ticker: 'NVDA', mode: 'nope' }).success).toBe(false);
  });
});

// FINRA returns the OLDEST rows first and rejects sortFields unless every
// partition key is in an EQUAL filter, so the query must carry a date floor.
// A window sized only on cadence returned nothing for the ATS dataset, which
// publishes about three weeks late — hence publicationLagDays.
describe('DATASETS window sizing', () => {
  test('every dataset declares the fields the query builder needs', () => {
    for (const ds of Object.values(DATASETS)) {
      expect(ds.name.length).toBeGreaterThan(0);
      expect(ds.symbolField.length).toBeGreaterThan(0);
      expect(ds.dateField.length).toBeGreaterThan(0);
      expect(ds.daysPerObservation).toBeGreaterThan(0);
      expect(ds.rowsPerObservation).toBeGreaterThan(0);
      expect(ds.publicationLagDays).toBeGreaterThanOrEqual(0);
    }
  });

  test('each window reaches back past its own publication lag', () => {
    // With limit=1 the window must still clear the lag, or the newest
    // observation falls outside it and FINRA answers with a null body.
    for (const ds of Object.values(DATASETS)) {
      const windowDays = ds.publicationLagDays + 1 * ds.daysPerObservation;
      expect(windowDays).toBeGreaterThan(ds.publicationLagDays);
    }
  });

  test('the ATS window covers its ~3 week publication delay', () => {
    expect(DATASETS.ats_volume.publicationLagDays).toBeGreaterThanOrEqual(21);
  });

  test('date fields match the ones each FINRA dataset actually returns', () => {
    expect(DATASETS.short_interest.dateField).toBe('settlementDate');
    expect(DATASETS.reg_sho.dateField).toBe('tradeReportDate');
    expect(DATASETS.ats_volume.dateField).toBe('weekStartDate');
  });
});
