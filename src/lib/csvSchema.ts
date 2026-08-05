export function csvSchemaKey(columns: readonly string[]): string {
  return JSON.stringify(
    columns
      .map((column) => column.trim())
      .sort((left, right) => left.localeCompare(right))
  )
}

export function groupItemsByCsvSchema<T>(
  items: readonly T[],
  columnsFor: (item: T) => readonly string[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = csvSchemaKey(columnsFor(item))
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}
