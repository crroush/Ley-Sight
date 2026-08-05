/// <reference lib="webworker" />

import Papa from 'papaparse'
import type {
  AppendableDataset,
  CsvColumnMapping,
  DataWorkerEvent,
  DataWorkerMessage,
  DatasetSummary,
  PackedDataset,
  PackedTableData,
} from '../lib/types'
import { GrowableTypedArray } from '../map/growable'
import { buildCompactSpatialIndex } from '../map/compactIndex'
import {
  projectLatitude,
  projectLongitude,
  validateCoordinate,
} from '../map/projection'
import { FieldColorBuilder } from './fieldColors'
import { gradientColor, type ColorPalette } from '../lib/colorPalettes'
import type { ColorValueMode } from '../lib/colorValueModes'
import { buildFineTimeHistogram } from '../lib/timeHistogram'
import { mergePackedTableData } from '../lib/tableData'
import { parseTimestamp } from '../lib/timestamps'
import { TableColumnBuilder, tableColumnTransferList } from './tableColumns'

const worker = self as DedicatedWorkerGlobalScope
let generation = 0

type PackedColumns = {
  x: Float64Array<ArrayBuffer>
  y: Float64Array<ArrayBuffer>
  semiMajor: Float32Array<ArrayBuffer>
  semiMinor: Float32Array<ArrayBuffer>
  rotation: Float32Array<ArrayBuffer>
  time: Float64Array<ArrayBuffer>
  colors: Uint32Array<ArrayBuffer>
}

type GrowableColumns = {
  x: GrowableTypedArray<Float64Array>
  y: GrowableTypedArray<Float64Array>
  semiMajor: GrowableTypedArray<Float32Array>
  semiMinor: GrowableTypedArray<Float32Array>
  rotation: GrowableTypedArray<Float32Array>
  time: GrowableTypedArray<Float64Array>
  colors: GrowableTypedArray<Uint32Array>
}

function emit(event: DataWorkerEvent, transfer: Transferable[] = []): void {
  worker.postMessage(event, transfer)
}

function emitDataset(
  requestId: number,
  summary: DatasetSummary,
  dataset: PackedDataset,
  tableData?: PackedTableData
): void {
  emit({ type: 'complete', requestId, summary, dataset, tableData }, [
    dataset.x.buffer,
    dataset.y.buffer,
    dataset.semiMajor.buffer,
    dataset.semiMinor.buffer,
    dataset.rotation.buffer,
    dataset.time.buffer,
    dataset.colors.buffer,
    dataset.timeHistogram.buffer,
    dataset.index.order.buffer,
    dataset.index.nodeStart.buffer,
    dataset.index.nodeEnd.buffer,
    dataset.index.nodeFirstIndex.buffer,
    dataset.index.nodeChildren.buffer,
    dataset.index.nodeMinX.buffer,
    dataset.index.nodeMinY.buffer,
    dataset.index.nodeMaxX.buffer,
    dataset.index.nodeMaxY.buffer,
    ...tableColumnTransferList(tableData?.columns ?? []),
  ])
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296
  }
}

function projectedX(longitude: number): number {
  return projectLongitude(longitude)
}

function projectedY(latitude: number): number {
  return projectLatitude(latitude)
}

function ellipseRotation(tilt: number): number {
  return ((90 - tilt) * Math.PI) / 180
}

function buildDataset(
  requestId: number,
  columns: PackedColumns,
  extent: [number, number, number, number],
  timeMin: number,
  timeMax: number
): PackedDataset {
  emit({
    type: 'progress',
    requestId,
    progress: {
      phase: 'indexing',
      completed: 0,
      total: columns.x.length,
    },
  })
  const index = buildCompactSpatialIndex(columns.x, columns.y)
  emit({
    type: 'progress',
    requestId,
    progress: {
      phase: 'indexing',
      completed: columns.x.length,
      total: columns.x.length,
    },
  })
  return {
    ...columns,
    timeHistogram: buildFineTimeHistogram(columns.time, timeMin, timeMax),
    extent,
    index,
  }
}

async function generateSynthetic(
  requestId: number,
  count: number,
  chunkSize: number,
  seed: number,
  token: number
): Promise<void> {
  const random = mulberry32(seed)
  const startedAt = Date.UTC(2024, 0, 1) / 1000
  const duration = 366 * 24 * 3600
  const clusters = [
    [-104.99, 39.74],
    [-122.42, 37.77],
    [-77.04, 38.9],
    [2.35, 48.86],
    [139.69, 35.68],
    [151.21, -33.87],
    [18.42, -33.93],
    [-58.38, -34.6],
  ]
  const columns: PackedColumns = {
    x: new Float64Array(count),
    y: new Float64Array(count),
    semiMajor: new Float32Array(count),
    semiMinor: new Float32Array(count),
    rotation: new Float32Array(count),
    time: new Float64Array(count),
    colors: new Uint32Array(count),
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let start = 0; start < count; start += chunkSize) {
    if (token !== generation) return
    const end = Math.min(count, start + chunkSize)
    for (let index = start; index < end; index += 1) {
      const clusterIndex = Math.floor(random() * clusters.length)
      const cluster = clusters[clusterIndex]
      const theta = random() * Math.PI * 2
      const radius = Math.pow(random(), 1.8) * (2 + random() * 22)
      const longitude = cluster[0] + Math.cos(theta) * radius
      const latitude = Math.max(
        -82,
        Math.min(82, cluster[1] + Math.sin(theta) * radius * 0.68)
      )
      const x = projectedX(longitude)
      const y = projectedY(latitude)
      columns.x[index] = x
      columns.y[index] = y
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      const major = 500 + Math.pow(random(), 2) * 120_000
      columns.semiMajor[index] = major
      columns.semiMinor[index] = major * (0.15 + random() * 0.7)
      columns.rotation[index] = ellipseRotation(random() * 180)
      columns.time[index] = startedAt + random() * duration
      columns.colors[index] = gradientColor(
        clusterIndex / Math.max(1, clusters.length - 1),
        'turbo',
        224
      )
    }
    emit({
      type: 'progress',
      requestId,
      progress: { phase: 'generating', completed: end, total: count },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (token !== generation) return

  const summary: DatasetSummary = {
    name: 'Synthetic geolocation lab',
    rowCount: count,
    timeMin: startedAt,
    timeMax: startedAt + duration,
    invalidRows: 0,
    invalidTimestamps: 0,
    coordinateFailures: 0,
    projectionClampedRows: 0,
  }
  const dataset = buildDataset(
    requestId,
    columns,
    count ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
    summary.timeMin,
    summary.timeMax
  )
  if (token === generation) emitDataset(requestId, summary, dataset)
}

function numeric(value: unknown, fallback = Number.NaN): number {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function growableColumns(): GrowableColumns {
  return {
    x: new GrowableTypedArray(Float64Array),
    y: new GrowableTypedArray(Float64Array),
    semiMajor: new GrowableTypedArray(Float32Array),
    semiMinor: new GrowableTypedArray(Float32Array),
    rotation: new GrowableTypedArray(Float32Array),
    time: new GrowableTypedArray(Float64Array),
    colors: new GrowableTypedArray(Uint32Array),
  }
}

function mergeColumn<T extends Float64Array | Float32Array | Uint32Array>(
  base: T | undefined,
  appended: T,
  Constructor: {
    new (length: number): T
  }
): T {
  if (!base?.length) return appended
  if (!appended.length) return base
  const merged = new Constructor(base.length + appended.length)
  merged.set(base, 0)
  merged.set(appended, base.length)
  return merged
}

async function parseFiles(
  requestId: number,
  files: File[],
  columns: CsvColumnMapping,
  allTableColumns: string[],
  colorField: string | undefined,
  colorPalette: ColorPalette,
  colorValueMode: ColorValueMode,
  totalFileCount: number,
  token: number,
  base?: AppendableDataset,
  tableBase?: PackedTableData
): Promise<void> {
  const hasBase = Boolean(base?.x.length)
  let rowCount = base?.x.length ?? 0
  let invalidRows = base?.invalidRows ?? 0
  let invalidTimestamps = base?.invalidTimestamps ?? 0
  let coordinateFailures = base?.coordinateFailures ?? 0
  let projectionClampedRows = base?.projectionClampedRows ?? 0
  let timeMin =
    hasBase && Number.isFinite(base!.timeMin) ? base!.timeMin : Infinity
  let timeMax =
    hasBase && Number.isFinite(base!.timeMax) ? base!.timeMax : -Infinity
  let minX = hasBase ? base!.extent[0] : Infinity
  let minY = hasBase ? base!.extent[1] : Infinity
  let maxX = hasBase ? base!.extent[2] : -Infinity
  let maxY = hasBase ? base!.extent[3] : -Infinity
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  let completedBytes = 0
  const values = growableColumns()
  const fieldColors = colorField
    ? new FieldColorBuilder(colorPalette, colorValueMode)
    : null
  const geometryColumns = new Set(
    [
      columns.latitude,
      columns.longitude,
      columns.time,
      columns.semiMajor,
      columns.semiMinor,
      columns.tilt,
    ].filter((column): column is string => typeof column === 'string')
  )
  const tableBuilders = allTableColumns
    .filter((column) => !geometryColumns.has(column))
    .map((name) => ({ name, builder: new TableColumnBuilder(name) }))

  for (const file of files) {
    if (token !== generation) return
    await new Promise<void>((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        transformHeader: (header) => header.trim(),
        skipEmptyLines: 'greedy',
        chunkSize: 4 * 1024 * 1024,
        chunk: (results, parser) => {
          if (token !== generation) {
            parser.abort()
            resolve()
            return
          }
          for (const row of results.data) {
            const longitude = numeric(row[columns.longitude])
            const latitude = numeric(row[columns.latitude])
            const coordinate = validateCoordinate(longitude, latitude)
            if (coordinate.status === 'invalid') {
              coordinateFailures += 1
              continue
            }
            if (coordinate.projectionClamped) projectionClampedRows += 1
            const [x, y] = coordinate.projected
            const timeValue = columns.time
              ? parseTimestamp(
                  row[columns.time],
                  columns.timestampInterpretation
                )
              : Number.NaN
            if (columns.time && !Number.isFinite(timeValue))
              invalidTimestamps += 1
            values.x.push(x)
            values.y.push(y)
            values.semiMajor.push(
              columns.semiMajor ? numeric(row[columns.semiMajor], 0) : 0
            )
            values.semiMinor.push(
              columns.semiMinor ? numeric(row[columns.semiMinor], 0) : 0
            )
            values.rotation.push(
              ellipseRotation(columns.tilt ? numeric(row[columns.tilt], 0) : 0)
            )
            values.time.push(timeValue)
            for (const { name, builder } of tableBuilders) {
              builder.push(row[name])
            }
            if (fieldColors) fieldColors.push(row[colorField!])
            else values.colors.push(0x3288bdde)
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x)
            maxY = Math.max(maxY, y)
            if (Number.isFinite(timeValue)) {
              timeMin = Math.min(timeMin, timeValue)
              timeMax = Math.max(timeMax, timeValue)
            }
            rowCount += 1
          }
          const cursor = results.meta.cursor ?? 0
          emit({
            type: 'progress',
            requestId,
            progress: {
              phase: 'parsing',
              completed: Math.min(totalBytes, completedBytes + cursor),
              total: totalBytes,
            },
          })
        },
        complete: () => resolve(),
        error: (error) => reject(error),
      })
    })
    completedBytes += file.size
  }
  if (token !== generation) return

  const summary: DatasetSummary = {
    name:
      totalFileCount === 1
        ? files[0].name
        : `${totalFileCount.toLocaleString()} CSV files`,
    rowCount,
    timeMin: Number.isFinite(timeMin) ? timeMin : Number.NaN,
    timeMax: Number.isFinite(timeMax) ? timeMax : Number.NaN,
    invalidRows,
    invalidTimestamps,
    coordinateFailures,
    projectionClampedRows,
  }
  const appendedColors = fieldColors
    ? fieldColors.finish()
    : (values.colors.view() as Uint32Array<ArrayBuffer>)
  const packed: PackedColumns = {
    x: mergeColumn(
      base?.x,
      values.x.view() as Float64Array<ArrayBuffer>,
      Float64Array
    ),
    y: mergeColumn(
      base?.y,
      values.y.view() as Float64Array<ArrayBuffer>,
      Float64Array
    ),
    semiMajor: mergeColumn(
      base?.semiMajor,
      values.semiMajor.view() as Float32Array<ArrayBuffer>,
      Float32Array
    ),
    semiMinor: mergeColumn(
      base?.semiMinor,
      values.semiMinor.view() as Float32Array<ArrayBuffer>,
      Float32Array
    ),
    rotation: mergeColumn(
      base?.rotation,
      values.rotation.view() as Float32Array<ArrayBuffer>,
      Float32Array
    ),
    time: mergeColumn(
      base?.time,
      values.time.view() as Float64Array<ArrayBuffer>,
      Float64Array
    ),
    colors: mergeColumn(base?.colors, appendedColors, Uint32Array),
  }
  const dataset = buildDataset(
    requestId,
    packed,
    rowCount ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
    summary.timeMin,
    summary.timeMax
  )
  const appendedTableData: PackedTableData = {
    rowCount: values.x.length,
    columns: tableBuilders.map(({ builder }) => builder.finish()),
  }
  const tableData = mergePackedTableData(tableBase ?? null, appendedTableData)
  if (token === generation) {
    emitDataset(requestId, summary, dataset, tableData ?? undefined)
  }
}

async function recolorFiles(
  requestId: number,
  files: File[],
  columns: CsvColumnMapping,
  colorField: string,
  colorPalette: ColorPalette,
  colorValueMode: ColorValueMode,
  token: number
): Promise<void> {
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  let completedBytes = 0
  const fieldColors = new FieldColorBuilder(colorPalette, colorValueMode)
  for (const file of files) {
    if (token !== generation) return
    await new Promise<void>((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        transformHeader: (header) => header.trim(),
        skipEmptyLines: 'greedy',
        chunkSize: 4 * 1024 * 1024,
        chunk: (results, parser) => {
          if (token !== generation) {
            parser.abort()
            resolve()
            return
          }
          for (const row of results.data) {
            const longitude = numeric(row[columns.longitude])
            const latitude = numeric(row[columns.latitude])
            if (validateCoordinate(longitude, latitude).status === 'invalid')
              continue
            fieldColors.push(row[colorField])
          }
          emit({
            type: 'progress',
            requestId,
            progress: {
              phase: 'coloring',
              completed: Math.min(
                totalBytes,
                completedBytes + (results.meta.cursor ?? 0)
              ),
              total: totalBytes,
            },
          })
        },
        complete: () => resolve(),
        error: (error) => reject(error),
      })
    })
    completedBytes += file.size
  }
  if (token !== generation) return
  const colors = fieldColors.finish()
  emit({ type: 'recolored', requestId, colorField, colors }, [colors.buffer])
}

worker.onmessage = async (event: MessageEvent<DataWorkerMessage>) => {
  const message = event.data
  if (message.type === 'reset') {
    generation += 1
    emit({ type: 'reset', requestId: message.requestId })
    return
  }
  const token = ++generation
  try {
    if (message.type === 'generate') {
      await generateSynthetic(
        message.requestId,
        message.count,
        message.chunkSize,
        message.seed,
        token
      )
    } else if (message.type === 'parse') {
      await parseFiles(
        message.requestId,
        message.files,
        message.columns,
        message.tableColumns,
        message.colorField,
        message.colorPalette,
        message.colorValueMode,
        message.totalFileCount,
        token,
        message.base,
        message.tableBase
      )
    } else if (message.type === 'recolor') {
      await recolorFiles(
        message.requestId,
        message.files,
        message.columns,
        message.colorField,
        message.colorPalette,
        message.colorValueMode,
        token
      )
    }
  } catch (error) {
    const recoveredBase = message.type === 'parse' ? message.base : undefined
    const recoveredTableBase =
      message.type === 'parse' ? message.tableBase : undefined
    emit(
      {
        type: 'error',
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
        recoveredBase,
        recoveredTableBase,
      },
      recoveredBase || recoveredTableBase
        ? [
            ...(recoveredBase
              ? [
                  recoveredBase.x.buffer,
                  recoveredBase.y.buffer,
                  recoveredBase.semiMajor.buffer,
                  recoveredBase.semiMinor.buffer,
                  recoveredBase.rotation.buffer,
                  recoveredBase.time.buffer,
                  recoveredBase.colors.buffer,
                ]
              : []),
            ...tableColumnTransferList(recoveredTableBase?.columns ?? []),
          ]
        : []
    )
  }
}

export {}
