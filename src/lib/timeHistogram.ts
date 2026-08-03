export type TimeRange = [number, number];

export function buildFineTimeHistogram(
  values: Float64Array,
  minimum: number,
  maximum: number,
  maximumBins = 262_144,
): Uint32Array<ArrayBuffer> {
  return buildMaskedTimeHistogram(values, undefined, minimum, maximum, maximumBins);
}

export function buildMaskedTimeHistogram(
  values: Float64Array,
  mask: Uint8Array | undefined,
  minimum: number,
  maximum: number,
  maximumBins = 262_144,
): Uint32Array<ArrayBuffer> {
  const targetBins = Math.min(
    maximumBins,
    Math.max(96, 2 ** Math.ceil(Math.log2(Math.max(1, values.length)))),
  );
  const counts = new Uint32Array(targetBins);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return counts;
  const span = Math.max(Number.EPSILON, maximum - minimum);
  for (let index = 0; index < values.length; index += 1) {
    if (mask && !mask[index]) continue;
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const bin = Math.max(
      0,
      Math.min(
        counts.length - 1,
        Math.floor(((value - minimum) / span) * counts.length),
      ),
    );
    counts[bin] += 1;
  }
  return counts;
}

export function clampTimeRange(
  start: number,
  end: number,
  minimum: number,
  maximum: number,
  minimumSpan = 1,
): TimeRange {
  const domainSpan = Math.max(minimumSpan, maximum - minimum);
  const span = Math.max(
    minimumSpan,
    Math.min(domainSpan, Math.abs(end - start)),
  );
  let nextStart = Math.max(minimum, Math.min(start, maximum - span));
  let nextEnd = nextStart + span;
  if (nextEnd > maximum) {
    nextEnd = maximum;
    nextStart = maximum - span;
  }
  return [nextStart, nextEnd];
}

export function moveFixedTimeWindow(
  start: number,
  end: number,
  delta: number,
  minimum: number,
  maximum: number,
): TimeRange {
  return clampTimeRange(
    start + delta,
    end + delta,
    minimum,
    maximum,
    Math.min(1, Math.max(Number.EPSILON, end - start)),
  );
}

export function aggregateTimeHistogram(
  source: Uint32Array,
  domainMinimum: number,
  domainMaximum: number,
  viewMinimum: number,
  viewMaximum: number,
  outputBinCount: number,
): Uint32Array {
  const output = new Uint32Array(Math.max(1, outputBinCount));
  if (
    source.length === 0 ||
    !Number.isFinite(domainMinimum) ||
    !Number.isFinite(domainMaximum) ||
    domainMaximum <= domainMinimum ||
    viewMaximum <= viewMinimum
  ) {
    return output;
  }
  const domainSpan = domainMaximum - domainMinimum;
  const sourceStart = Math.max(
    0,
    Math.floor(
      ((viewMinimum - domainMinimum) / domainSpan) * source.length,
    ),
  );
  const sourceEnd = Math.min(
    source.length,
    Math.ceil(
      ((viewMaximum - domainMinimum) / domainSpan) * source.length,
    ),
  );
  const viewSpan = viewMaximum - viewMinimum;
  for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
    const count = source[sourceIndex];
    if (!count) continue;
    const center =
      domainMinimum +
      ((sourceIndex + 0.5) / source.length) * domainSpan;
    if (center < viewMinimum || center > viewMaximum) continue;
    const outputIndex = Math.min(
      output.length - 1,
      Math.max(
        0,
        Math.floor(((center - viewMinimum) / viewSpan) * output.length),
      ),
    );
    output[outputIndex] += count;
  }
  return output;
}

export function formatFullTimestamp(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Date(value * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC")
    .replace("Z", " UTC");
}

export function formatTimeAxisTick(value: number, spanSeconds: number): string {
  if (!Number.isFinite(value)) return "—";
  const date = new Date(value * 1000);
  const iso = date.toISOString();
  if (spanSeconds <= 120) return iso.slice(11, 23);
  if (spanSeconds <= 2 * 24 * 3600) return iso.slice(11, 19);
  if (spanSeconds <= 120 * 24 * 3600) {
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }
  if (spanSeconds <= 3 * 365 * 24 * 3600) return iso.slice(0, 10);
  return iso.slice(0, 4);
}
