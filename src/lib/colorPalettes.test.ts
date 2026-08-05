import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COLOR_PALETTES, gradientColor, paletteCss } from './colorPalettes'

describe('color palettes', () => {
  it('offers distinct perceptual gradients with Turbo first', () => {
    assert.equal(COLOR_PALETTES[0].value, 'turbo')
    assert.ok(COLOR_PALETTES.length >= 6)
    for (const palette of COLOR_PALETTES) {
      assert.notEqual(
        gradientColor(0, palette.value),
        gradientColor(1, palette.value)
      )
      assert.match(paletteCss(palette.value), /^linear-gradient/)
    }
  })

  it('clamps values to the gradient domain', () => {
    assert.equal(gradientColor(-10), gradientColor(0))
    assert.equal(gradientColor(10), gradientColor(1))
  })
})
