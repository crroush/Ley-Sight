export type LayerToggle = { id: string; label: string; visible: boolean }
export function LayerControls({
  layers,
  onToggle,
}: {
  layers: readonly LayerToggle[]
  onToggle: (id: string, visible: boolean) => void
}) {
  return (
    <fieldset>
      {layers.map((layer) => (
        <label key={layer.id}>
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={(event) => onToggle(layer.id, event.target.checked)}
          />
          {layer.label}
        </label>
      ))}
    </fieldset>
  )
}
