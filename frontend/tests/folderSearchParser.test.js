const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFolderSearchQuery } = require('../folderSearchParser.js');

test('recognises the requested explicit folder-listing forms', () => {
  assert.deepEqual(parseFolderSearchQuery('all files of folder statistical analysis'), {
    folderName: 'statistical analysis',
  });
  assert.deepEqual(parseFolderSearchQuery('all files of Statistical Analysis'), {
    folderName: 'Statistical Analysis',
  });
  assert.deepEqual(parseFolderSearchQuery('all files in the folder "Statistical Analysis"'), {
    folderName: 'Statistical Analysis',
  });
});

test('leaves ordinary retrieval queries alone', () => {
  assert.equal(parseFolderSearchQuery('statistical analysis'), null);
  assert.equal(parseFolderSearchQuery('find all files about statistical analysis'), null);
  assert.equal(parseFolderSearchQuery('all files after July 2026'), null);
});
