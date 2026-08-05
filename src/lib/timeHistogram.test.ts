import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMaskedTimeHistogram,
  aggregateTimeHistogram,
  buildFineTimeHistogram,
  clampTimeRange,
  formatTimeAxisTick,
  moveFixedTimeWindow,
} from './timeHistogram'

describe('time histogram controls', () => {
  it('builds a bounded fine histogram and includes the maximum', () => {
    const values = Float64Array.from([0, 0.5, 1, Number.NaN])
    const bins = buildFineTimeHistogram(values, 0, 1, 128)
    assert.equal(bins.length, 96)
    assert.equal(
      bins.reduce((total, count) => total + count, 0),
      3
    )
    assert.equal(bins[bins.length - 1], 1)
  })

  it('excludes manually hidden rows from histogram counts', () => {
    const values = Float64Array.from([0, 0.5, 1])
    const bins = buildMaskedTimeHistogram(
      values,
      Uint8Array.from([1, 0, 1]),
      0,
      1,
      128
    )
    assert.equal(
      bins.reduce((total, count) => total + count, 0),
      2
    )
    assert.equal(bins[0], 1)
    assert.equal(bins[bins.length - 1], 1)
  })

  it('moves a fixed-width filter window without crossing the domain', () => {
    assert.deepEqual(moveFixedTimeWindow(20, 40, 15, 0, 100), [35, 55])
    assert.deepEqual(moveFixedTimeWindow(20, 40, 90, 0, 100), [80, 100])
    assert.deepEqual(moveFixedTimeWindow(20, 40, -90, 0, 100), [0, 20])
  })

  it('clamps a refined global view', () => {
    assert.deepEqual(clampTimeRange(-5, 25, 0, 100), [0, 30])
    assert.deepEqual(clampTimeRange(80, 120, 0, 100), [60, 100])
  })

  it('reaggregates fine full-domain bins into the viewed extent', () => {
    const source = Uint32Array.from({ length: 100 }, (_, index) => index + 1)
    const output = aggregateTimeHistogram(source, 0, 100, 25, 75, 10)
    const expected = source
      .slice(25, 75)
      .reduce((total, count) => total + count, 0)
    assert.equal(
      output.reduce((total, count) => total + count, 0),
      expected
    )
  })

  it('shows time-of-day and seconds for sub-day axes', () => {
    const timestamp = Date.UTC(2024, 0, 1, 12, 34, 56) / 1000
    assert.equal(formatTimeAxisTick(timestamp, 3600), '12:34:56')
    assert.equal(formatTimeAxisTick(timestamp, 30), '12:34:56.000')
    assert.match(formatTimeAxisTick(timestamp, 30 * 24 * 3600), /01-01 12:34/)
  })
})
