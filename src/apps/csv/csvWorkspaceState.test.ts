import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DatasetSummary, PackedDataset } from '../../lib/types'
import {
  UNIFORM_COLOR_FIELD,
  combinedMapDataset,
  csvCell,
  displayColors,
  persistenceLabel,
  workspaceManifest,
  type DatasetTab,
} from './csvWorkspaceState'

function dataset(xs: number[], ys: number[], times: number[]): PackedDataset {
  return {
    x: new Float64Array(xs),
    y: new Float64Array(ys),
    semiMajor: new Float32Array(xs.length),
    semiMinor: new Float32Array(xs.length),
    rotation: new Float32Array(xs.length),
    time: new Float64Array(times),
    colors: new Uint32Array(xs.map((_, index) => 0x01020300 + index)),
    extent: [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ],
    index: { root: 0, nodes: new Int32Array(), indices: new Uint32Array() },
    timeHistogram: new Uint32Array(96),
  }
}

function summary(
  name: string,
  rowCount: number,
  timeMin: number,
  timeMax: number
): DatasetSummary {
  return { name, rowCount, timeMin, timeMax, invalidRows: 0 }
}

function tab(overrides: Partial<DatasetTab>): DatasetTab {
  return {
    id: 1,
    kind: 'csv',
    schemaKey: 'schema',
    title: 'Tab',
    columns: ['lat', 'lon'],
    files: [new File(['lat,lon\n1,2'], 'input.csv', { type: 'text/csv' })],
    persistedFiles: [],
    colorField: UNIFORM_COLOR_FIELD,
    colorPalette: 'turbo',
    colorValueMode: 'categorical',
    dataset: dataset([1], [2], [10]),
    tableData: null,
    summary: summary('Tab', 1, 10, 10),
    status: 'ready',
    ...overrides,
  }
}

describe('csv workspace state helpers', () => {
  it('escapes CSV cells only when needed', () => {
    assert.equal(csvCell('plain'), 'plain')
    assert.equal(csvCell('a,"b"'), '"a,""b"""')
  })

  it('maps persistence states to compact UI labels', () => {
    assert.equal(persistenceLabel('checking'), 'CHECKING STORAGE')
    assert.equal(persistenceLabel('unavailable'), 'SESSION ONLY')
  })

  it('renders uniform display colors without mutating source colors', () => {
    const source = dataset([1, 2], [3, 4], [5, 6])
    const colors = displayColors(
      tab({ dataset: source, summary: summary('A', 2, 5, 6) })
    )
    assert.deepEqual(Array.from(colors), [0x3288bdde, 0x3288bdde])
    assert.deepEqual(Array.from(source.colors), [0x01020300, 0x01020301])
  })

  it('combines active and background datasets with active row counts preserved', () => {
    const first = tab({
      id: 1,
      dataset: dataset([1, 2], [3, 4], [10, 20]),
      summary: summary('First', 2, 10, 20),
    })
    const second = tab({
      id: 2,
      dataset: dataset([5], [6], [30]),
      summary: summary('Second', 1, 30, 30),
    })
    const combined = combinedMapDataset([first, second], 1)
    assert.ok(combined)
    assert.equal(combined.activeRows, 2)
    assert.equal(combined.summary.rowCount, 3)
    assert.equal(combined.summary.name, '2 datasets')
    assert.deepEqual(Array.from(combined.dataset.x), [1, 2, 5])
  })

  it('persists only ready CSV tabs with complete OPFS metadata', () => {
    const ready = tab({
      storageId: 'storage-1',
      mapping: { latitude: 'lat', longitude: 'lon' },
      persistedFiles: [
        {
          storageId: 'file-1',
          name: 'input.csv',
          type: 'text/csv',
          size: 11,
          lastModified: 1,
        },
      ],
      timeFilterRange: [1, 2],
      timeViewRange: [0, 3],
    })
    const loading = tab({ id: 2, status: 'loading', storageId: 'storage-2' })
    const manifest = workspaceManifest([ready, loading], ready.id)
    assert.equal(manifest.activeStorageId, 'storage-1')
    assert.equal(manifest.tabs.length, 1)
    assert.equal(manifest.tabs[0].schemaKey, 'schema')
    assert.deepEqual(manifest.tabs[0].timeFilterRange, [1, 2])
  })
})
