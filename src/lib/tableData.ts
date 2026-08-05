import type {
  CategoricalTableColumn,
  PackedTableColumn,
  PackedTableData,
} from './types'

function mergeAsCategories(
  first: PackedTableColumn,
  firstLength: number,
  second: PackedTableColumn,
  secondLength: number
): CategoricalTableColumn {
  const dictionary = ['']
  const known = new Map<string, number>([['', 0]])
  const codes = new Uint32Array(firstLength + secondLength)
  const append = (
    column: PackedTableColumn,
    length: number,
    offset: number
  ): void => {
    for (let index = 0; index < length; index += 1) {
      const numeric = column.kind === 'number' ? column.values[index] : 0
      const value =
        column.kind === 'number'
          ? Number.isFinite(numeric)
            ? String(numeric)
            : ''
          : (column.dictionary[column.codes[index]] ?? '')
      let code = known.get(value)
      if (code == null) {
        code = dictionary.length
        dictionary.push(value)
        known.set(value, code)
      }
      codes[offset + index] = code
    }
  }
  append(first, firstLength, 0)
  append(second, secondLength, firstLength)
  return { kind: 'category', name: first.name, codes, dictionary }
}

/**
 * Merges table payloads when another CSV with the same schema joins a tab.
 * Geometry fields are intentionally absent and remain owned by the map engine.
 */
export function mergePackedTableData(
  first: PackedTableData | null,
  second: PackedTableData | undefined
): PackedTableData | null {
  if (!second) return first
  if (!first) return second
  const secondByName = new Map(
    second.columns.map((column) => [column.name, column])
  )
  const columns = first.columns.map((column): PackedTableColumn => {
    const appended = secondByName.get(column.name)
    if (!appended) {
      throw new Error(`Appended table data is missing "${column.name}".`)
    }
    if (column.kind === 'number' && appended.kind === 'number') {
      const values = new Float64Array(first.rowCount + second.rowCount)
      values.set(column.values)
      values.set(appended.values, first.rowCount)
      return { kind: 'number', name: column.name, values }
    }
    return mergeAsCategories(column, first.rowCount, appended, second.rowCount)
  })
  return {
    rowCount: first.rowCount + second.rowCount,
    columns,
  }
}
