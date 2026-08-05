import type {RefObject} from "react";

type SplitPaneSeparatorProps = {
  containerRef: RefObject<HTMLElement | null>;
  percent: number;
  setPercent: (percent: number) => void;
  orientation: "horizontal" | "vertical";
  min?: number;
  max?: number;
  label: string;
};

export function SplitPaneSeparator({containerRef, percent, setPercent, orientation, min = 20, max = 80, label}: SplitPaneSeparatorProps) {
  const horizontal = orientation === "horizontal";
  return <div className={horizontal ? "reference-row-separator" : "reference-column-separator"} role="separator" aria-label={label} aria-orientation={orientation} tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add("is-dragging"); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = containerRef.current?.getBoundingClientRect(); if (!bounds) return; const size = horizontal ? bounds.height : bounds.width; if (size <= 0) return; const offset = horizontal ? event.clientY - bounds.top : event.clientX - bounds.left; setPercent(Math.max(min, Math.min(max, (offset / size) * 100))); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); event.currentTarget.classList.remove("is-dragging"); }} onPointerCancel={(event) => event.currentTarget.classList.remove("is-dragging")} onKeyDown={(event) => { const lowerKey = horizontal ? "ArrowUp" : "ArrowLeft"; const higherKey = horizontal ? "ArrowDown" : "ArrowRight"; if (event.key === lowerKey) { event.preventDefault(); setPercent(Math.max(min, percent - 2)); } else if (event.key === higherKey) { event.preventDefault(); setPercent(Math.min(max, percent + 2)); } }} />;
}
