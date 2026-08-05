type TypedArray = Float64Array | Float32Array | Uint32Array | Uint8Array

type TypedArrayConstructor<T extends TypedArray> = {
  new (length: number): T
}

export class GrowableTypedArray<T extends TypedArray> {
  private values: T
  readonly ArrayType: TypedArrayConstructor<T>
  length = 0

  constructor(ArrayType: TypedArrayConstructor<T>, initialCapacity = 65_536) {
    this.ArrayType = ArrayType
    this.values = new ArrayType(initialCapacity)
  }

  get capacity(): number {
    return this.values.length
  }

  clear(): void {
    this.length = 0
  }

  append(chunk: ArrayLike<number>): number {
    const start = this.length
    this.ensureCapacity(start + chunk.length)
    this.values.set(chunk, start)
    this.length += chunk.length
    return start
  }

  push(value: number): number {
    const index = this.length
    this.ensureCapacity(index + 1)
    this.values[index] = value
    this.length += 1
    return index
  }

  get(index: number): number {
    return this.values[index]
  }

  set(index: number, value: number): void {
    this.values[index] = value
  }

  fill(value: number, start = 0, end = this.length): void {
    this.values.fill(value, start, end)
  }

  view(): T {
    return this.values.subarray(0, this.length) as T
  }

  snapshot(): T {
    return this.values.slice(0, this.length) as T
  }

  private ensureCapacity(required: number): void {
    if (required <= this.values.length) return
    let capacity = Math.max(1, this.values.length)
    while (capacity < required) capacity *= 2
    const next = new this.ArrayType(capacity)
    next.set(this.values)
    this.values = next
  }
}
