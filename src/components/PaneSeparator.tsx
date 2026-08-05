import { useRef } from 'react'

type PaneSeparatorProps = {
  label: string
  onDrag: (deltaY: number) => void
  onStep: (deltaY: number) => void
}

export function PaneSeparator({ label, onDrag, onStep }: PaneSeparatorProps) {
  const originRef = useRef(0)
  const lastRef = useRef(0)

  return (
    <div
      className="pane-separator"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      tabIndex={0}
      onPointerDown={(event) => {
        originRef.current = event.clientY
        lastRef.current = 0
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.classList.add('is-dragging')
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const totalDelta = event.clientY - originRef.current
        const incrementalDelta = totalDelta - lastRef.current
        lastRef.current = totalDelta
        onDrag(incrementalDelta)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        event.currentTarget.classList.remove('is-dragging')
      }}
      onPointerCancel={(event) => {
        event.currentTarget.classList.remove('is-dragging')
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          onStep(-20)
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          onStep(20)
        }
      }}
    >
      <span />
    </div>
  )
}
