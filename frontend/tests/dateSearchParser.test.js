const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeterministicMonthDateQuery } = require('../dateSearchParser.js');

const monthStart = (year, monthIndex) =>
  Math.floor(new Date(year, monthIndex, 1, 0, 0, 0, 0).getTime() / 1000);

test('all does not change a deterministic after-month request', () => {
  const plain = parseDeterministicMonthDateQuery('files after July 2026');
  const all = parseDeterministicMonthDateQuery('all files after July 2026');

  assert.deepEqual(plain, all);
  assert.deepEqual(all, {
    cleanQuery: '',
    dateFrom: monthStart(2026, 7),
    dateTo: null,
  });
});

test('month constraints use exclusive boundaries', () => {
  assert.deepEqual(parseDeterministicMonthDateQuery('files before July 2026'), {
    cleanQuery: '',
    dateFrom: null,
    dateTo: monthStart(2026, 6),
  });
  assert.deepEqual(parseDeterministicMonthDateQuery('files during July 2026'), {
    cleanQuery: '',
    dateFrom: monthStart(2026, 6),
    dateTo: monthStart(2026, 7),
  });
});

test('mixed queries retain searchable words while removing metadata scaffolding', () => {
  assert.deepEqual(
    parseDeterministicMonthDateQuery('all Python files about authentication modified after July 2026'),
    {
      cleanQuery: 'Python authentication',
      dateFrom: monthStart(2026, 7),
      dateTo: null,
    },
  );
});
