import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReferenceRandom,
  createReferenceRandomGenerator,
} from './referenceData';

const EXPECTED = new Map<number, readonly number[]>([
  [7, [0.625095466604667, 0.8972138009695755, 0.7756856902451935]],
  [17, [0.8450747927979015, 0.16097309116910696, 0.5577445473656921]],
  [42, [0.7739560485559633, 0.4388784397520523, 0.8585979199113825]],
  [43, [0.6522992627009107, 0.04377532363899661, 0.020029586874216854]],
]);

test('Reference random streams match NumPy default_rng PCG64 output', () => {
  for (const [seed, expected] of EXPECTED) {
    const random = createReferenceRandom(seed);
    assert.deepEqual(
      expected.map(() => random()),
      expected
    );
  }
});

test("Reference integer draws preserve NumPy's buffered uint32 stream", () => {
  const generator = createReferenceRandomGenerator(42);
  assert.equal(generator.random(), 0.7739560485559633);
  assert.equal(generator.random(), 0.4388784397520523);
  assert.equal(generator.integer(3, 6), 4);
  assert.equal(generator.integer(50, 100), 92);
  assert.equal(generator.random(), 0.6973680290593639);
  assert.equal(generator.integer(50, 255), 91);
  assert.equal(generator.integer(50, 255), 69);
});
