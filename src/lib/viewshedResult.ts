export type ViewshedResultState = {
  activeRunId: number | null;
  status: 'idle' | 'running' | 'success' | 'error';
  resultTimestamp: number | null;
  errorMessage: string | null;
};

export type ViewshedResultAction =
  | {type: 'START'; runId: number}
  | {type: 'SUCCESS'; runId: number; timestamp: number}
  | {type: 'ERROR'; runId: number; timestamp: number; message: string};

export const initialViewshedResultState: ViewshedResultState = {
  activeRunId: null,
  status: 'idle',
  resultTimestamp: null,
  errorMessage: null,
};

/** Ignores results from runs which are no longer active. */
export function reduceViewshedResult(
  state: ViewshedResultState,
  action: ViewshedResultAction
): ViewshedResultState {
  if (action.type !== 'START' && action.runId !== state.activeRunId)
    return state;
  if (action.type === 'START') {
    return {
      activeRunId: action.runId,
      status: 'running',
      resultTimestamp: null,
      errorMessage: null,
    };
  }
  return action.type === 'SUCCESS'
    ? {
        ...state,
        status: 'success',
        resultTimestamp: action.timestamp,
        errorMessage: null,
      }
    : {
        ...state,
        status: 'error',
        resultTimestamp: action.timestamp,
        errorMessage: action.message,
      };
}

/** Owns the one object URL used by the visibility layer. */
export class VisibilityObjectUrl {
  current: string | null = null;

  replace(blob: Blob): string {
    this.clear();
    this.current = URL.createObjectURL(blob);
    return this.current;
  }

  clear(): void {
    if (this.current) URL.revokeObjectURL(this.current);
    this.current = null;
  }
}

export function viewshedPayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object')
    return 'The viewshed result did not include an image buffer.';
  const value = payload as Record<string, unknown>;
  if (!(value.buffer instanceof ArrayBuffer))
    return 'The viewshed result did not include an image buffer.';
  if (
    !Number.isInteger(value.nx) ||
    (value.nx as number) <= 0 ||
    !Number.isInteger(value.ny) ||
    (value.ny as number) <= 0
  )
    return 'The viewshed result has invalid image dimensions.';
  if (
    !Array.isArray(value.bounds) ||
    value.bounds.length !== 4 ||
    !value.bounds.every(
      (item) => typeof item === 'number' && Number.isFinite(item)
    )
  )
    return 'The viewshed result has invalid map bounds.';
  if (
    value.buffer.byteLength !==
    (value.nx as number) * (value.ny as number) * 4
  )
    return 'The viewshed result image buffer has an unexpected size.';
  return null;
}
