export function TimelineRange({min, max, value, onChange}: {min: number; max: number; value: [number, number]; onChange: (value: [number, number]) => void}) {
  return <div className="reference-timeline-range"><input aria-label="Timeline minimum" type="range" min={min} max={max} value={value[0]} onChange={(event) => onChange([Math.min(Number(event.target.value), value[1]), value[1]])} /><input aria-label="Timeline maximum" type="range" min={min} max={max} value={value[1]} onChange={(event) => onChange([value[0], Math.max(Number(event.target.value), value[0])])} /></div>;
}
