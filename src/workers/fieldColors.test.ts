import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  categoricalFieldColor,
  FieldColorBuilder,
  inferFieldColorMode,
  resolveFieldColorMode,
} from './fieldColors';

describe('CSV field colors', () => {
  it('assigns stable categorical colors', () => {
    assert.equal(
      categoricalFieldColor('alpha'),
      categoricalFieldColor('alpha')
    );
    assert.notEqual(
      categoricalFieldColor('alpha'),
      categoricalFieldColor('bravo')
    );
  });

  it('uses a continuous scale for numeric fields', () => {
    const builder = new FieldColorBuilder();
    for (let value = 0; value < 1_000; value += 1) builder.push(String(value));
    const colors = builder.finish();
    assert.equal(colors.length, 1_000);
    assert.notEqual(colors[0], colors[500]);
    assert.notEqual(colors[500], colors[999]);
  });

  it('can treat any numeric field as categories without using its name', () => {
    assert.equal(
      resolveFieldColorMode('categorical', ['741852963', '159357284']),
      'categorical'
    );
    const builder = new FieldColorBuilder('turbo', 'categorical');
    for (let index = 0; index < 300; index += 1) {
      builder.push(index % 2 ? '741852963' : '159357284');
    }
    const colors = builder.finish();
    assert.equal(colors[1], categoricalFieldColor('741852963'));
    assert.equal(colors[0], categoricalFieldColor('159357284'));
    assert.notEqual(colors[0], colors[1]);
  });

  it('treats numeric strings with significant leading zeroes as categories', () => {
    assert.equal(
      inferFieldColorMode(['00123', '00456', '00123']),
      'categorical'
    );
    assert.equal(
      resolveFieldColorMode('continuous', ['00123', '00456', '00123']),
      'numeric'
    );
  });

  it('keeps one output color per source row, including blanks', () => {
    const builder = new FieldColorBuilder();
    for (let index = 0; index < 300; index += 1) {
      builder.push(index % 3 === 0 ? '' : `group-${index % 5}`);
    }
    assert.equal(builder.finish().length, 300);
  });

  it('uses a continuous scale for timestamp fields', () => {
    const builder = new FieldColorBuilder();
    for (let day = 1; day <= 300; day += 1) {
      builder.push(new Date(Date.UTC(2024, 0, day)).toISOString());
    }
    const colors = builder.finish();
    assert.notEqual(colors[0], colors[150]);
    assert.notEqual(colors[150], colors[299]);
  });

  it('applies the selected gradient to field values', () => {
    const turbo = new FieldColorBuilder('turbo');
    const viridis = new FieldColorBuilder('viridis');
    for (let value = 0; value < 300; value += 1) {
      turbo.push(value);
      viridis.push(value);
    }
    assert.notDeepEqual(
      Array.from(turbo.finish().slice(0, 10)),
      Array.from(viridis.finish().slice(0, 10))
    );
  });
});
