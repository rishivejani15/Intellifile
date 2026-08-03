const test = require('node:test');
const assert = require('node:assert/strict');
const { createListDirectoryController } = require('../listDirectoryCache.js');

test('deduplicates concurrent requests for the same path', async () => {
  let calls = 0;
  const controller = createListDirectoryController({
    readDirectory: async () => {
      calls += 1;
      return [{ name: 'file.txt', path: 'C:/tmp/file.txt', type: 'file' }];
    }
  });

  const [first, second] = await Promise.all([
    controller.get('C:/tmp', { showHidden: false }),
    controller.get('C:/tmp', { showHidden: false })
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test('returns cached data for a recent request', async () => {
  let calls = 0;
  const controller = createListDirectoryController({
    readDirectory: async () => {
      calls += 1;
      return [{ name: 'a.txt', path: 'C:/tmp/a.txt', type: 'file' }];
    },
    ttlMs: 1000
  });

  const first = await controller.get('C:/tmp', { showHidden: false });
  const second = await controller.get('C:/tmp', { showHidden: false });

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});
