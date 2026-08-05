import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WEB_MERCATOR_HALF_WORLD,
  createRoot,
  insert,
  nearestPoint,
  type PointAccessor,
} from './quadtree'

const processEnv = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env

describe(
  'million-point index benchmark',
  { skip: !processEnv?.RUN_MILLION_BENCHMARK },
  () => {
    it(
      'builds and queries one million typed-array points',
      { timeout: 30_000 },
      () => {
        const count = 1_000_000
        const x = new Float64Array(count)
        const y = new Float64Array(count)
        const visible = new Uint8Array(count)
        visible.fill(1)
        let state = 0x51a7cafe
        const random = () => {
          state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
          return state / 4_294_967_296
        }
        for (let index = 0; index < count; index += 1) {
          x[index] = (random() * 2 - 1) * WEB_MERCATOR_HALF_WORLD
          y[index] = (random() * 2 - 1) * WEB_MERCATOR_HALF_WORLD
        }
        const accessor: PointAccessor = {
          x: (index) => x[index],
          y: (index) => y[index],
          isVisible: (index) => visible[index] === 1,
        }
        const root = createRoot()
        const started = performance.now()
        for (let index = 0; index < count; index += 1) {
          insert(root, index, accessor)
        }
        const buildMs = performance.now() - started
        const queryStarted = performance.now()
        const selected = nearestPoint(
          root,
          accessor,
          [x[500_000], y[500_000]],
          1
        )
        const queryMs = performance.now() - queryStarted
        console.info(
          `MILLION_POINT_BENCHMARK build_ms=${buildMs.toFixed(1)} query_ms=${queryMs.toFixed(3)}`
        )
        assert.equal(root.visibleCount, count)
        assert.equal(selected, 500_000)
      }
    )
  }
)
