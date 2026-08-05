import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import type {
  BaseLayerDefinition,
  ManagedLayerDefinition,
  MapLayerSettings,
} from '../lib/types'
import { ModalDialog } from './ModalDialog'

type LayerManagerDialogProps = {
  baseLayers: BaseLayerDefinition[]
  wmsPresets: ManagedLayerDefinition[]
  settings: MapLayerSettings
  onChange: (settings: MapLayerSettings) => void
  onClose: () => void
}

type NewLayer = {
  type: 'wms' | 'xyz'
  name: string
  url: string
  layers: string
}

const EMPTY_LAYER: NewLayer = {
  type: 'wms',
  name: '',
  url: '',
  layers: '',
}

function newLayerId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `layer-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`
}

export function LayerManagerDialog({
  baseLayers,
  wmsPresets,
  settings,
  onChange,
  onClose,
}: LayerManagerDialogProps) {
  const [draft, setDraft] = useState<NewLayer>(EMPTY_LAYER)
  const updateLayer = (
    id: string,
    update: Partial<ManagedLayerDefinition>
  ): void => {
    onChange({
      ...settings,
      managedLayers: settings.managedLayers.map((layer) =>
        layer.id === id ? { ...layer, ...update } : layer
      ),
    })
  }
  const addLayer = (definition: ManagedLayerDefinition): void => {
    onChange({
      ...settings,
      managedLayers: [...settings.managedLayers, definition],
    })
  }
  const addDraft = (): void => {
    if (!draft.name.trim() || !draft.url.trim()) return
    if (draft.type === 'wms' && !draft.layers.trim()) return
    addLayer({
      id: newLayerId(),
      name: draft.name.trim(),
      type: draft.type,
      url: draft.url.trim(),
      layers: draft.type === 'wms' ? draft.layers.trim() : undefined,
      opacity: 0.8,
      visible: true,
    })
    setDraft(EMPTY_LAYER)
  }

  return (
    <ModalDialog
      className="layer-dialog"
      titleId="layers-title"
      descriptionId="layers-description"
      onDismiss={onClose}
      initialFocus="#layers-title"
    >
      <div className="dialog-header">
        <div>
          <span className="eyebrow">MAP</span>
          <h2 id="layers-title" tabIndex={-1}>
            Layer manager
          </h2>
          <p id="layers-description">
            Choose base tiles and add browser-accessible WMS or XYZ layers.
          </p>
        </div>
      </div>

      <div className="layer-dialog-body">
        <section className="layer-section">
          <h3>Base map</h3>
          <div className="layer-form base-layer-form">
            <label>
              <span>Preset</span>
              <select
                value={
                  baseLayers.some((layer) => layer.id === settings.baseLayer.id)
                    ? settings.baseLayer.id
                    : '__custom__'
                }
                onChange={(event) => {
                  const baseLayer = baseLayers.find(
                    (layer) => layer.id === event.target.value
                  ) ?? {
                    id: 'custom-xyz',
                    name: 'Custom XYZ',
                    type: 'xyz' as const,
                    url: '',
                  }
                  onChange({ ...settings, baseLayer })
                }}
              >
                {baseLayers.map((layer) => (
                  <option value={layer.id} key={layer.id}>
                    {layer.name}
                  </option>
                ))}
                <option value="__custom__">Custom XYZ tiles</option>
              </select>
            </label>
            <label>
              <span>Tile URL</span>
              <input
                value={settings.baseLayer.url ?? ''}
                disabled={settings.baseLayer.type === 'osm'}
                placeholder="https://tiles.example/{z}/{x}/{y}.png"
                onChange={(event) =>
                  onChange({
                    ...settings,
                    baseLayer: {
                      ...settings.baseLayer,
                      type: 'xyz',
                      url: event.target.value,
                    },
                  })
                }
              />
            </label>
          </div>
          <label className="check-row compact-row">
            <input
              type="checkbox"
              checked={settings.baseVisible}
              onChange={(event) =>
                onChange({ ...settings, baseVisible: event.target.checked })
              }
            />
            <span>
              <strong>Show base map</strong>
            </span>
          </label>
          <label className="range-row compact-row">
            <span>
              <strong>Base opacity</strong>
              <small>{Math.round(settings.baseOpacity * 100)}%</small>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.baseOpacity}
              onChange={(event) =>
                onChange({
                  ...settings,
                  baseOpacity: Number(event.target.value),
                })
              }
            />
          </label>
        </section>

        <section className="layer-section">
          <div className="section-heading">
            <h3>Overlay layers</h3>
            <small>WMS uses tiled GetMap requests.</small>
          </div>
          {settings.managedLayers.length ? (
            <div className="managed-layer-list">
              {settings.managedLayers.map((layer) => (
                <div className="managed-layer" key={layer.id}>
                  <button
                    className="icon-button"
                    aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                    onClick={() =>
                      updateLayer(layer.id, { visible: !layer.visible })
                    }
                  >
                    {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <div>
                    <strong>{layer.name}</strong>
                    <small>
                      {layer.type.toUpperCase()}
                      {layer.layers ? ` · ${layer.layers}` : ''}
                    </small>
                  </div>
                  <input
                    aria-label={`${layer.name} opacity`}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={layer.opacity}
                    onChange={(event) =>
                      updateLayer(layer.id, {
                        opacity: Number(event.target.value),
                      })
                    }
                  />
                  <button
                    className="icon-button danger-icon"
                    aria-label={`Remove ${layer.name}`}
                    onClick={() =>
                      onChange({
                        ...settings,
                        managedLayers: settings.managedLayers.filter(
                          (candidate) => candidate.id !== layer.id
                        ),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-layer-list">No overlay layers configured.</p>
          )}

          {wmsPresets.length > 0 && (
            <label className="preset-row">
              <span>WMS preset</span>
              <select
                defaultValue=""
                onChange={(event) => {
                  const preset = wmsPresets.find(
                    (layer) => layer.id === event.target.value
                  )
                  if (preset) addLayer({ ...preset, id: newLayerId() })
                  event.currentTarget.value = ''
                }}
              >
                <option value="">Choose preset…</option>
                {wmsPresets.map((layer) => (
                  <option value={layer.id} key={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="layer-form add-layer-form">
            <label>
              <span>Type</span>
              <select
                value={draft.type}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    type: event.target.value as 'wms' | 'xyz',
                  })
                }
              >
                <option value="wms">WMS</option>
                <option value="xyz">XYZ tiles</option>
              </select>
            </label>
            <label>
              <span>Name</span>
              <input
                value={draft.name}
                placeholder="Weather radar"
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label className="wide-field">
              <span>Server / tile URL</span>
              <input
                value={draft.url}
                placeholder={
                  draft.type === 'wms'
                    ? 'https://server.example/geoserver/wms'
                    : 'https://server.example/{z}/{x}/{y}.png'
                }
                onChange={(event) =>
                  setDraft({ ...draft, url: event.target.value })
                }
              />
            </label>
            {draft.type === 'wms' && (
              <label>
                <span>WMS LAYERS</span>
                <input
                  value={draft.layers}
                  placeholder="workspace:layer_name"
                  onChange={(event) =>
                    setDraft({ ...draft, layers: event.target.value })
                  }
                />
              </label>
            )}
            <button className="button secondary" onClick={addDraft}>
              <Plus size={15} /> Add layer
            </button>
          </div>
        </section>

        <section className="layer-section">
          <h3>Map overlays and data geometry</h3>
          <label className="check-row compact-row">
            <input
              type="checkbox"
              checked={settings.countriesVisible}
              onChange={(event) =>
                onChange({
                  ...settings,
                  countriesVisible: event.target.checked,
                })
              }
            />
            <span>
              <strong>Country boundaries</strong>
              <small>Show the packaged, date-line-wrapped country layer.</small>
            </span>
          </label>
          <label className="color-setting-row compact-row">
            <span>Country stroke color</span>
            <input
              type="color"
              value={settings.countryStrokeColor}
              onChange={(event) =>
                onChange({
                  ...settings,
                  countryStrokeColor: event.target.value,
                })
              }
            />
          </label>
          <label className="color-setting-row compact-row">
            <span>Map background color</span>
            <input
              type="color"
              value={settings.mapBackgroundColor}
              onChange={(event) =>
                onChange({
                  ...settings,
                  mapBackgroundColor: event.target.value,
                })
              }
            />
          </label>
          <label className="check-row compact-row">
            <input
              type="checkbox"
              checked={settings.coordinatesVisible}
              onChange={(event) =>
                onChange({
                  ...settings,
                  coordinatesVisible: event.target.checked,
                })
              }
            />
            <span>
              <strong>Pointer coordinates</strong>
              <small>Show live latitude and longitude on the map.</small>
            </span>
          </label>
          <label className="check-row compact-row">
            <input
              type="checkbox"
              checked={settings.ellipsesVisible}
              onChange={(event) =>
                onChange({
                  ...settings,
                  ellipsesVisible: event.target.checked,
                })
              }
            />
            <span>
              <strong>Uncertainty ellipses</strong>
              <small>Draw viewport-visible, quadtree-collapsed ellipses.</small>
            </span>
          </label>
          <label className="check-row compact-row">
            <input
              type="checkbox"
              checked={settings.selectedEllipsesVisible}
              onChange={(event) =>
                onChange({
                  ...settings,
                  selectedEllipsesVisible: event.target.checked,
                })
              }
            />
            <span>
              <strong>Selected ellipses</strong>
              <small>Keep selected uncertainty geometry visible.</small>
            </span>
          </label>
        </section>
      </div>
      <div className="dialog-actions">
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </ModalDialog>
  )
}
