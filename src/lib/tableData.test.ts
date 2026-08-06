import assert from 'node:assert/strict';
import test from 'node:test';
import {mergePackedTableData} from './tableData';
import type {PackedTableData} from './types';

test('same-schema table payloads append in source-row order', () => {
  const first: PackedTableData = {
    rowCount: 2,
    columns: [
      {
        kind: 'number',
        name: 'speed',
        values: Float64Array.from([2, 4]) as Float64Array<ArrayBuffer>,
      },
    ],
  };
  const second: PackedTableData = {
    rowCount: 1,
    columns: [
      {
        kind: 'number',
        name: 'speed',
        values: Float64Array.from([6]) as Float64Array<ArrayBuffer>,
      },
    ],
  };
  const merged = mergePackedTableData(first, second);
  assert.equal(merged?.rowCount, 3);
  assert.deepEqual(
    Array.from(
      merged?.columns[0].kind === 'number' ? merged.columns[0].values : []
    ),
    [2, 4, 6]
  );
});

test('dictionary values are remapped while appending', () => {
  const first: PackedTableData = {
    rowCount: 2,
    columns: [
      {
        kind: 'category',
        name: 'name',
        codes: Uint32Array.from([1, 2]) as Uint32Array<ArrayBuffer>,
        dictionary: ['', 'Alpha', 'Beta'],
      },
    ],
  };
  const second: PackedTableData = {
    rowCount: 2,
    columns: [
      {
        kind: 'category',
        name: 'name',
        codes: Uint32Array.from([1, 2]) as Uint32Array<ArrayBuffer>,
        dictionary: ['', 'Beta', 'Gamma'],
      },
    ],
  };
  const merged = mergePackedTableData(first, second);
  assert.ok(merged);
  const column = merged.columns[0];
  assert.equal(column.kind, 'category');
  if (column.kind !== 'category') return;
  assert.deepEqual(
    Array.from(column.codes, (code) => column.dictionary[code]),
    ['Alpha', 'Beta', 'Beta', 'Gamma']
  );
});
