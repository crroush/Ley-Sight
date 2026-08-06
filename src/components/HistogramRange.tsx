import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {PanelBottomClose} from 'lucide-react';
import {
  aggregateTimeHistogram,
  clampTimeRange,
  formatFullTimestamp,
  formatTimeAxisTick,
  moveFixedTimeWindow,
  type TimeRange,
} from '../lib/timeHistogram';

type HistogramRangeProps = {
  bins: Uint32Array;
  minimum: number;
  maximum: number;
  start: number;
  end: number;
  viewStart: number;
  viewEnd: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
  onViewChange: (start: number, end: number) => void;
  onCollapse?: () => void;
};

type DragState = {
  kind:
    | 'filter-start'
    | 'filter-end'
    | 'filter-window'
    | 'view-start'
    | 'view-end'
    | 'view-window';
  originX: number;
  initial: TimeRange;
};

function tickValues(start: number, end: number): number[] {
  return Array.from(
    {length: 5},
    (_, index) => start + (index / 4) * (end - start)
  );
}

function percent(value: number, start: number, end: number): number {
  if (end <= start) return 0;
  return Math.max(0, Math.min(100, ((value - start) / (end - start)) * 100));
}

export function HistogramRange({
  bins,
  minimum,
  maximum,
  start,
  end,
  viewStart,
  viewEnd,
  disabled,
  onChange,
  onViewChange,
  onCollapse,
}: HistogramRangeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const filterDraftRef = useRef<TimeRange>([start, end]);
  const viewDraftRef = useRef<TimeRange>([viewStart, viewEnd]);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [draftViewStart, setDraftViewStart] = useState(viewStart);
  const [draftViewEnd, setDraftViewEnd] = useState(viewEnd);
  const [plotWidth, setPlotWidth] = useState(480);

  useEffect(() => {
    if (dragRef.current?.kind.startsWith('filter')) return;
    filterDraftRef.current = [start, end];
    setDraftStart(start);
    setDraftEnd(end);
  }, [start, end]);

  useEffect(() => {
    if (dragRef.current?.kind.startsWith('view')) return;
    viewDraftRef.current = [viewStart, viewEnd];
    setDraftViewStart(viewStart);
    setDraftViewEnd(viewEnd);
  }, [viewStart, viewEnd]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const observer = new ResizeObserver(() => {
      setPlotWidth(Math.max(1, plot.clientWidth));
    });
    observer.observe(plot);
    setPlotWidth(Math.max(1, plot.clientWidth));
    return () => observer.disconnect();
  }, []);

  const displayBins = useMemo(
    () =>
      aggregateTimeHistogram(
        bins,
        minimum,
        maximum,
        draftViewStart,
        draftViewEnd,
        Math.max(48, Math.min(360, Math.floor(plotWidth / 3)))
      ),
    [bins, minimum, maximum, draftViewStart, draftViewEnd, plotWidth]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, bounds.width, bounds.height);
    let maximumCount = 1;
    for (const count of displayBins)
      maximumCount = Math.max(maximumCount, count);
    const width = bounds.width / Math.max(1, displayBins.length);
    context.fillStyle = '#38bdf8';
    for (let index = 0; index < displayBins.length; index += 1) {
      const height =
        (displayBins[index] / maximumCount) * Math.max(1, bounds.height - 7);
      context.fillRect(
        index * width,
        bounds.height - height,
        Math.max(1, width - 1),
        height
      );
    }
  }, [displayBins]);

  const setFilterDraft = (range: TimeRange): void => {
    filterDraftRef.current = range;
    setDraftStart(range[0]);
    setDraftEnd(range[1]);
  };

  const setViewDraft = (range: TimeRange): void => {
    viewDraftRef.current = range;
    setDraftViewStart(range[0]);
    setDraftViewEnd(range[1]);
  };

  const beginPlotDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const startX =
      (percent(draftStart, draftViewStart, draftViewEnd) / 100) * bounds.width;
    const endX =
      (percent(draftEnd, draftViewStart, draftViewEnd) / 100) * bounds.width;
    const x = event.clientX - bounds.left;
    const hitWidth = 10;
    let kind: DragState['kind'];
    if (Math.abs(x - startX) <= hitWidth) kind = 'filter-start';
    else if (Math.abs(x - endX) <= hitWidth) kind = 'filter-end';
    else if (x > Math.min(startX, endX) && x < Math.max(startX, endX)) {
      kind = 'filter-window';
    } else {
      kind =
        Math.abs(x - startX) < Math.abs(x - endX)
          ? 'filter-start'
          : 'filter-end';
    }
    dragRef.current = {
      kind,
      originX: event.clientX,
      initial: [draftStart, draftEnd],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePlotDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || !drag.kind.startsWith('filter')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewSpan = Math.max(Number.EPSILON, draftViewEnd - draftViewStart);
    const delta =
      ((event.clientX - drag.originX) / Math.max(1, bounds.width)) * viewSpan;
    const pointerRatio = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))
    );
    const pointerValue = draftViewStart + pointerRatio * viewSpan;
    const minimumStep = Math.max(
      0.001,
      Math.min(1, (maximum - minimum) / 10_000)
    );
    if (drag.kind === 'filter-window') {
      setFilterDraft(
        moveFixedTimeWindow(
          drag.initial[0],
          drag.initial[1],
          delta,
          minimum,
          maximum
        )
      );
      return;
    }
    const value =
      drag.kind === 'filter-start'
        ? Math.max(minimum, Math.min(pointerValue, draftEnd - minimumStep))
        : Math.min(maximum, Math.max(pointerValue, draftStart + minimumStep));
    setFilterDraft(
      drag.kind === 'filter-start' ? [value, draftEnd] : [draftStart, value]
    );
  };

  const endPlotDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current?.kind.startsWith('filter')) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    onChange(...filterDraftRef.current);
  };

  const beginOverviewDrag = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const startX =
      (percent(draftViewStart, minimum, maximum) / 100) * bounds.width;
    const endX = (percent(draftViewEnd, minimum, maximum) / 100) * bounds.width;
    const x = event.clientX - bounds.left;
    const hitWidth = 10;
    let kind: DragState['kind'];
    if (Math.abs(x - startX) <= hitWidth) kind = 'view-start';
    else if (Math.abs(x - endX) <= hitWidth) kind = 'view-end';
    else if (x > Math.min(startX, endX) && x < Math.max(startX, endX)) {
      kind = 'view-window';
    } else {
      kind =
        Math.abs(x - startX) < Math.abs(x - endX) ? 'view-start' : 'view-end';
    }
    dragRef.current = {
      kind,
      originX: event.clientX,
      initial: [draftViewStart, draftViewEnd],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveOverviewDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || !drag.kind.startsWith('view')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const domainSpan = Math.max(Number.EPSILON, maximum - minimum);
    const delta =
      ((event.clientX - drag.originX) / Math.max(1, bounds.width)) * domainSpan;
    const pointerRatio = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))
    );
    const pointerValue = minimum + pointerRatio * domainSpan;
    if (drag.kind === 'view-window') {
      setViewDraft(
        moveFixedTimeWindow(
          drag.initial[0],
          drag.initial[1],
          delta,
          minimum,
          maximum
        )
      );
      return;
    }
    const minimumSpan = Math.max(1, domainSpan / 100_000);
    const value =
      drag.kind === 'view-start'
        ? Math.max(minimum, Math.min(pointerValue, draftViewEnd - minimumSpan))
        : Math.min(
            maximum,
            Math.max(pointerValue, draftViewStart + minimumSpan)
          );
    setViewDraft(
      drag.kind === 'view-start'
        ? [value, draftViewEnd]
        : [draftViewStart, value]
    );
  };

  const endOverviewDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current?.kind.startsWith('view')) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    onViewChange(...viewDraftRef.current);
  };

  const zoomView = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (disabled) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))
    );
    const span = Math.max(1, draftViewEnd - draftViewStart);
    const nextSpan = Math.max(
      1,
      Math.min(maximum - minimum, span * (event.deltaY < 0 ? 0.75 : 1.35))
    );
    const cursor = draftViewStart + ratio * span;
    const range = clampTimeRange(
      cursor - ratio * nextSpan,
      cursor + (1 - ratio) * nextSpan,
      minimum,
      maximum,
      1
    );
    setViewDraft(range);
    onViewChange(...range);
  };

  const viewTicks = tickValues(draftViewStart, draftViewEnd);
  const domainTicks = tickValues(minimum, maximum);
  const viewSpan = draftViewEnd - draftViewStart;
  const domainSpan = maximum - minimum;
  const filterLeft = percent(draftStart, draftViewStart, draftViewEnd);
  const filterRight = percent(draftEnd, draftViewStart, draftViewEnd);
  const overviewLeft = percent(draftViewStart, minimum, maximum);
  const overviewRight = percent(draftViewEnd, minimum, maximum);

  return (
    <section className="histogram-panel" aria-label="Time activity filter">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">TIME ACTIVITY</span>
          <strong>
            {formatFullTimestamp(draftStart)}
            <span className="muted"> to </span>
            {formatFullTimestamp(draftEnd)}
          </strong>
        </div>
        <div className="time-actions">
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => {
              setFilterDraft([minimum, maximum]);
              onChange(minimum, maximum);
            }}
          >
            Reset filter
          </button>
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => {
              setViewDraft([minimum, maximum]);
              onViewChange(minimum, maximum);
            }}
          >
            Reset view
          </button>
          {onCollapse && (
            <button
              className="panel-drawer-button"
              type="button"
              aria-label="Collapse time activity"
              title="Collapse time activity"
              onClick={onCollapse}
            >
              <PanelBottomClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={plotRef}
        className={`histogram-plot ${disabled ? 'is-disabled' : ''}`}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={beginPlotDrag}
        onPointerMove={movePlotDrag}
        onPointerUp={endPlotDrag}
        onPointerCancel={endPlotDrag}
        onWheel={zoomView}
        onContextMenu={(event) => {
          event.preventDefault();
          if (disabled) return;
          setViewDraft([minimum, maximum]);
          onViewChange(minimum, maximum);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const delta = (viewSpan / 100) * (event.key === 'ArrowLeft' ? -1 : 1);
          const range = moveFixedTimeWindow(
            draftStart,
            draftEnd,
            delta,
            minimum,
            maximum
          );
          setFilterDraft(range);
          onChange(...range);
        }}
      >
        <canvas ref={canvasRef} />
        <div
          className="filter-window"
          style={{
            left: `${Math.min(filterLeft, filterRight)}%`,
            width: `${Math.max(0, Math.abs(filterRight - filterLeft))}%`,
          }}
        />
        <i
          className="time-handle filter-handle"
          style={{left: `${filterLeft}%`}}
          title={`Filter start: ${formatFullTimestamp(draftStart)}`}
        />
        <i
          className="time-handle filter-handle"
          style={{left: `${filterRight}%`}}
          title={`Filter stop: ${formatFullTimestamp(draftEnd)}`}
        />
      </div>

      <div className="time-axis" aria-hidden="true">
        {viewTicks.map((value, index) => (
          <span key={index}>{formatTimeAxisTick(value, viewSpan)}</span>
        ))}
      </div>

      <div
        ref={overviewRef}
        className={`time-overview ${disabled ? 'is-disabled' : ''}`}
        tabIndex={disabled ? -1 : 0}
        aria-label="Global histogram start and stop"
        onPointerDown={beginOverviewDrag}
        onPointerMove={moveOverviewDrag}
        onPointerUp={endOverviewDrag}
        onPointerCancel={endOverviewDrag}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const delta =
            (domainSpan / 100) * (event.key === 'ArrowLeft' ? -1 : 1);
          const range = moveFixedTimeWindow(
            draftViewStart,
            draftViewEnd,
            delta,
            minimum,
            maximum
          );
          setViewDraft(range);
          onViewChange(...range);
        }}
      >
        <div
          className="view-window"
          style={{
            left: `${Math.min(overviewLeft, overviewRight)}%`,
            width: `${Math.max(0, Math.abs(overviewRight - overviewLeft))}%`,
          }}
        />
        <i
          className="time-handle view-handle"
          style={{left: `${overviewLeft}%`}}
          title={`Histogram start: ${formatFullTimestamp(draftViewStart)}`}
        />
        <i
          className="time-handle view-handle"
          style={{left: `${overviewRight}%`}}
          title={`Histogram stop: ${formatFullTimestamp(draftViewEnd)}`}
        />
      </div>

      <div className="time-axis overview-axis" aria-hidden="true">
        {domainTicks.map((value, index) => (
          <span key={index}>{formatTimeAxisTick(value, domainSpan)}</span>
        ))}
      </div>
    </section>
  );
}
