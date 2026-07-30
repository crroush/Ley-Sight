/// <reference lib="webworker" />

import {sourceIndexPosition} from "../lib/tableSelection";

type SortDirection = "ascending" | "descending";

type SortMessage =
  | {
      type: "sort-index";
      requestId: number;
      rowCount: number;
      direction: SortDirection;
      focusIndex: number;
      visibleIndices: Uint32Array<ArrayBuffer> | null;
    }
  | {
      type: "sort-number";
      requestId: number;
      values: Float64Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
      direction: SortDirection;
      invert: boolean;
      focusIndex: number;
      visibleIndices: Uint32Array<ArrayBuffer> | null;
    }
  | {
      type: "sort-category";
      requestId: number;
      codes: Uint32Array<ArrayBuffer>;
      dictionary: string[];
      direction: SortDirection;
      focusIndex: number;
      visibleIndices: Uint32Array<ArrayBuffer> | null;
    }
  | {
      type: "filter";
      requestId: number;
      focusIndex: number;
      visibleIndices: Uint32Array<ArrayBuffer> | null;
    };

type SortResult = {
  type: "result";
  requestId: number;
  indices: Uint32Array<ArrayBuffer>;
  focusPosition: number;
};

const worker = self as DedicatedWorkerGlobalScope;
let fullOrder = new Uint32Array(0) as Uint32Array<ArrayBuffer>;

function naturalOrder(
  rowCount: number,
  descending: boolean,
): Uint32Array<ArrayBuffer> {
  const order = new Uint32Array(rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    order[index] = descending ? rowCount - index - 1 : index;
  }
  return order;
}

function numericOrder(
  values: Float64Array | Float32Array,
  descending: boolean,
): Uint32Array<ArrayBuffer> {
  const order = naturalOrder(values.length, false);
  const direction = descending ? -1 : 1;
  order.sort((first, second) => {
    const left = values[first];
    const right = values[second];
    const leftMissing = !Number.isFinite(left);
    const rightMissing = !Number.isFinite(right);
    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return first - second;
      return leftMissing ? 1 : -1;
    }
    const compared = (left - right) * direction;
    return compared || first - second;
  });
  return order;
}

/**
 * Dictionary ranks turn string sorting into an O(rows + categories log
 * categories) counting pass instead of comparing strings for every row pair.
 */
function categoryOrder(
  codes: Uint32Array,
  dictionary: readonly string[],
  descending: boolean,
): Uint32Array<ArrayBuffer> {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const sortedCodes = naturalOrder(dictionary.length, false);
  sortedCodes.sort((first, second) => {
    const compared = collator.compare(
      dictionary[first] ?? "",
      dictionary[second] ?? "",
    );
    return (descending ? -compared : compared) || first - second;
  });

  const rank = new Uint32Array(dictionary.length);
  for (let index = 0; index < sortedCodes.length; index += 1) {
    rank[sortedCodes[index]] = index;
  }
  const counts = new Uint32Array(dictionary.length);
  for (const code of codes) counts[rank[code]] += 1;
  let offset = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index];
    counts[index] = offset;
    offset += count;
  }
  const order = new Uint32Array(codes.length);
  for (let index = 0; index < codes.length; index += 1) {
    const categoryRank = rank[codes[index]];
    order[counts[categoryRank]++] = index;
  }
  return order;
}

function filteredOrder(
  order: Uint32Array,
  visibleIndices: Uint32Array | null,
  focusIndex: number,
): {indices: Uint32Array<ArrayBuffer>; focusPosition: number} {
  if (!visibleIndices) {
    const indices = order.slice() as Uint32Array<ArrayBuffer>;
    return {
      indices,
      focusPosition: sourceIndexPosition(indices, focusIndex),
    };
  }
  const visible = new Uint8Array(order.length);
  for (const index of visibleIndices) {
    if (index < visible.length) visible[index] = 1;
  }
  const output = new Uint32Array(visibleIndices.length);
  let cursor = 0;
  let focusPosition = -1;
  for (const index of order) {
    if (!visible[index]) continue;
    if (index === focusIndex) focusPosition = cursor;
    output[cursor++] = index;
  }
  return {
    indices: (cursor === output.length
      ? output
      : output.slice(0, cursor)) as Uint32Array<ArrayBuffer>,
    focusPosition,
  };
}

function emit(
  requestId: number,
  visibleIndices: Uint32Array | null,
  focusIndex: number,
): void {
  const {indices, focusPosition} = filteredOrder(
    fullOrder,
    visibleIndices,
    focusIndex,
  );
  const result: SortResult = {
    type: "result",
    requestId,
    indices,
    focusPosition,
  };
  worker.postMessage(result, [indices.buffer]);
}

worker.onmessage = (event: MessageEvent<SortMessage>): void => {
  const message = event.data;
  if (message.type === "filter") {
    emit(message.requestId, message.visibleIndices, message.focusIndex);
    return;
  }
  const descending = message.direction === "descending";
  if (message.type === "sort-index") {
    fullOrder = naturalOrder(message.rowCount, descending);
  } else if (message.type === "sort-number") {
    fullOrder = numericOrder(
      message.values,
      message.invert ? !descending : descending,
    );
  } else {
    fullOrder = categoryOrder(
      message.codes,
      message.dictionary,
      descending,
    );
  }
  emit(message.requestId, message.visibleIndices, message.focusIndex);
};

export {};
