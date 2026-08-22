'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function validateCoverage(completedSlices, expectedTotal) {
  const sortedSlices = Array.from(completedSlices.values()).sort((a, b) => a.start - b.start);
  let coverageCursor = 0;
  for (const s of sortedSlices) {
    if (s.start !== coverageCursor) {
      throw new Error(`[DIRECT_RANGE_GAP_DETECTED] Gap at byte ${coverageCursor}`);
    }
    coverageCursor = s.end + 1;
  }
  if (coverageCursor !== expectedTotal) {
    throw new Error(`[DIRECT_RANGE_INCOMPLETE_COVERAGE] Ended at ${coverageCursor}, expected ${expectedTotal}`);
  }
  return true;
}

test('monotonic coverage passes when all slices are present and contiguous', () => {
  const slices = new Map();
  slices.set(0, { start: 0, end: 1048575, length: 1048576 });
  slices.set(1048576, { start: 1048576, end: 2097151, length: 1048576 });
  slices.set(2097152, { start: 2097152, end: 2500000, length: 402849 });

  assert.equal(validateCoverage(slices, 2500001), true);
});

test('monotonic coverage rejects when there is a missing gap', () => {
  const slices = new Map();
  slices.set(0, { start: 0, end: 1048575, length: 1048576 });
  // Missing 1048576 - 2097151
  slices.set(2097152, { start: 2097152, end: 2500000, length: 402849 });

  assert.throws(
    () => validateCoverage(slices, 2500001),
    /DIRECT_RANGE_GAP_DETECTED/
  );
});

test('monotonic coverage rejects when total is shorter than expected', () => {
  const slices = new Map();
  slices.set(0, { start: 0, end: 1048575, length: 1048576 });

  assert.throws(
    () => validateCoverage(slices, 2500001),
    /DIRECT_RANGE_INCOMPLETE_COVERAGE/
  );
});
