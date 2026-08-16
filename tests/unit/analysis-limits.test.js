// The memory ceilings on an analysis pass. These numbers are the difference
// between a pass that runs for hours and one that takes the machine down, so
// they get tested as policy rather than trusted as constants.

import { describe, it, expect } from 'vitest';
import {
  memoryBudgetMb, poolSize,
  MAX_POOL_SIZE, WORKER_BUDGET_MB, MEMORY_BUDGET_MAX_MB, RESERVED_CORES,
} from '../../src/renderer/analysis/limits.js';

const GB = 1024;

describe('memoryBudgetMb', () => {
  it('takes a share of a small machine rather than a flat amount', () => {
    // An 8 GB Mac must not be sized like a big one; the fraction binds here.
    expect(memoryBudgetMb(8 * GB)).toBeLessThan(MEMORY_BUDGET_MAX_MB);
    expect(memoryBudgetMb(8 * GB)).toBeGreaterThan(WORKER_BUDGET_MB);
  });

  it('caps a large machine at the flat ceiling', () => {
    expect(memoryBudgetMb(64 * GB)).toBe(MEMORY_BUDGET_MAX_MB);
    expect(memoryBudgetMb(128 * GB)).toBe(MEMORY_BUDGET_MAX_MB);
  });

  it('scales with the machine', () => {
    expect(memoryBudgetMb(4 * GB)).toBeLessThan(memoryBudgetMb(8 * GB));
  });

  it('refuses a missing or nonsense RAM figure instead of guessing', () => {
    // A dropped query param must fail loudly, not silently size the pool at 1
    // -- or, worse, at NaN.
    expect(() => memoryBudgetMb(NaN)).toThrow(/RAM/);
    expect(() => memoryBudgetMb(0)).toThrow(/RAM/);
  });
});

describe('poolSize', () => {
  const big = { budgetMb: 100000, cores: 64, queueDepth: 10000 };

  it('never promises more memory than the budget allows', () => {
    for (const budgetMb of [256, 512, 1024, 4096]) {
      const workers = poolSize({ ...big, budgetMb });
      expect(workers * WORKER_BUDGET_MB).toBeLessThanOrEqual(Math.max(budgetMb, WORKER_BUDGET_MB));
    }
  });

  it('is bounded by the flat ceiling however big the machine is', () => {
    expect(poolSize(big)).toBe(MAX_POOL_SIZE);
  });

  it('leaves cores for the UI and the OS', () => {
    expect(poolSize({ ...big, cores: 4 })).toBe(4 - RESERVED_CORES);
  });

  it('does not load six copies of the model to analyze one song', () => {
    expect(poolSize({ ...big, queueDepth: 1 })).toBe(1);
    expect(poolSize({ ...big, queueDepth: 3 })).toBe(3);
  });

  it('always runs at least one worker, even on a tiny machine', () => {
    expect(poolSize({ budgetMb: 64, cores: 2, queueDepth: 1 })).toBe(1);
  });

  it('refuses missing inputs rather than sizing the pool from NaN', () => {
    expect(() => poolSize({ budgetMb: NaN, cores: 8, queueDepth: 10 })).toThrow(/budgetMb/);
    expect(() => poolSize({ budgetMb: 1024, cores: 0, queueDepth: 10 })).toThrow(/cores/);
    expect(() => poolSize({ budgetMb: 1024, cores: 8, queueDepth: undefined })).toThrow(/queueDepth/);
  });

  it('keeps a 16 GB Mac well under a gigabyte of analysis workers', () => {
    // The configuration the user actually ran when the machine ran out of RAM.
    const workers = poolSize({ budgetMb: memoryBudgetMb(16 * GB), cores: 10, queueDepth: 3901 });
    expect(workers * WORKER_BUDGET_MB).toBeLessThanOrEqual(MEMORY_BUDGET_MAX_MB);
    expect(workers).toBeGreaterThanOrEqual(2);  // still worth running in parallel
  });
});
