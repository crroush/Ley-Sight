import OLMap from 'ol/Map.js';
import View from 'ol/View.js';
import ImageLayer from 'ol/layer/Image.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import ImageCanvasSource from 'ol/source/ImageCanvas.js';
import OSM from 'ol/source/OSM.js';
import TileWMS from 'ol/source/TileWMS.js';
import VectorSource from 'ol/source/Vector.js';
import XYZ from 'ol/source/XYZ.js';
import DragBox from 'ol/interaction/DragBox.js';
import Draw from 'ol/interaction/Draw.js';
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js';
import {fromLonLat, toLonLat} from 'ol/proj.js';
import LineString from 'ol/geom/LineString.js';
import {getDistance} from 'ol/sphere.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import type {StyleFunction} from 'ol/style/Style.js';
import type {
  BaseLayerDefinition,
  CompactSpatialIndex,
  DatasetSummary,
  EngineDatasetState,
  EngineSelectionState,
  ManagedLayerDefinition,
  MeasurementState,
  PackedDataset,
  RenderMetrics,
} from '../lib/types';
import {imageCanvasPixelSize} from './imageCanvasGeometry';
import {gradientColor, type ColorPalette} from '../lib/colorPalettes';
import {buildMaskedTimeHistogram} from '../lib/timeHistogram';
import {renderQueryExtents, wrapXForExtent, type Extent} from './quadtree';
import {
  rebuildNodeSelectionCounts,
  selectExtentIntoMask,
} from './selectionIndex';
import {
  installReferenceCoordinateDisplay,
  type ReferenceCoordinateDisplay,
} from './referenceCoordinateDisplay';
import {modifierBoxSelection} from './selectionInteractions';
import {geodesicLine} from './geodesic';
import {
  createPackagedCountryLayers,
  type PackagedCountryLayers,
} from './countryLayers';

export type EngineOptions = {
  target: HTMLElement;
  onSelectionChange?: (state: EngineSelectionState) => void;
  onMetrics?: (metrics: RenderMetrics) => void;
  onPointerCoordinate?: (coordinate: [number, number] | null) => void;
  onMeasurementChange?: (state: MeasurementState) => void;
  /** CSS color used for measurement paths and vertices. Defaults to red. */
  measurementColor?: string;
};

type RenderStyle = {
  radius: number;
  selectedRadius: number;
  defaultColor: number;
  selectedColor: number;
  ellipseWidth: number;
  ellipseFillAlpha: number;
  ellipseColor: number | null;
  selectedEllipseColor: number | null;
  minEllipsePixels: number;
  collapsePixels: number;
};

export type PointRenderStyle = Pick<
  RenderStyle,
  'radius' | 'selectedRadius' | 'defaultColor' | 'selectedColor'
>;

export type EllipseRenderStyle = Pick<
  RenderStyle,
  | 'ellipseWidth'
  | 'ellipseFillAlpha'
  | 'ellipseColor'
  | 'selectedEllipseColor'
  | 'minEllipsePixels'
>;

const DEFAULT_STYLE: RenderStyle = {
  radius: 3,
  selectedRadius: 6,
  defaultColor: 0x3288bdde,
  selectedColor: 0x22d3eeff,
  ellipseWidth: 1.25,
  ellipseFillAlpha: 18,
  ellipseColor: null,
  selectedEllipseColor: null,
  minEllipsePixels: 0.7,
  collapsePixels: 3,
};

const EMPTY_INDEX: CompactSpatialIndex = {
  order: new Uint32Array(),
  nodeStart: new Uint32Array(),
  nodeEnd: new Uint32Array(),
  nodeFirstIndex: new Uint32Array(),
  nodeChildren: new Int32Array(),
  nodeMinX: new Float64Array(),
  nodeMinY: new Float64Array(),
  nodeMaxX: new Float64Array(),
  nodeMaxY: new Float64Array(),
};

function colorToCss(color: number, opacity = 1): string {
  const red = (color >>> 24) & 255;
  const green = (color >>> 16) & 255;
  const blue = (color >>> 8) & 255;
  const alpha = (color & 255) / 255;
  return `rgba(${red},${green},${blue},${alpha * opacity})`;
}

function withAlpha(color: number, alpha: number): number {
  return ((color & 0xffffff00) | Math.max(0, Math.min(255, alpha))) >>> 0;
}

export function createMeasurementStyle(color: string): StyleFunction {
  const stroke = new Stroke({
    color,
    width: 3,
    lineCap: 'round',
    lineJoin: 'round',
  });
  const image = new CircleStyle({
    radius: 5,
    fill: new Fill({color: '#071019'}),
    stroke: new Stroke({color, width: 2}),
  });
  const pointStyle = new Style({image});

  return (feature, resolution) => {
    const geometry = feature.getGeometry();
    if (!(geometry instanceof LineString)) return pointStyle;
    return new Style({
      geometry: geodesicLine(geometry.getCoordinates(), undefined, resolution),
      stroke,
      image,
    });
  };
}

export class FastPointEngine {
  readonly map: OLMap;
  private readonly layer: ImageLayer<ImageCanvasSource>;
  private readonly source: ImageCanvasSource;
  private readonly baseLayer: TileLayer<OSM | XYZ>;
  private readonly measurementSource = new VectorSource();
  private readonly measurementLayer: VectorLayer<VectorSource>;
  private readonly measurementDraw: Draw;
  private readonly dragBox: DragBox;
  private readonly managedLayers = new Map<string, TileLayer<XYZ | TileWMS>>();
  private readonly coordinateDisplay: ReferenceCoordinateDisplay;
  private readonly countryLayers: PackagedCountryLayers;
  private x = new Float64Array();
  private y = new Float64Array();
  private semiMajor = new Float32Array();
  private semiMinor = new Float32Array();
  private rotation = new Float32Array();
  private timestamps = new Float64Array();
  private colors = new Uint32Array();
  private visible = new Uint8Array();
  private manualVisible = new Uint8Array();
  private deleted = new Uint8Array();
  private selected = new Uint8Array();
  private spatial = EMPTY_INDEX;
  private nodeVisible = new Uint32Array();
  private nodeSelected = new Uint32Array();
  private selectedCountValue = 0;
  private selectionFocusIndexValue = -1;
  private selectionRevision = 0;
  private dataExtent: Extent = [0, 0, 0, 0];
  private timeMinimum = Number.NaN;
  private timeMaximum = Number.NaN;
  private hasDeleted = false;
  private readonly onSelectionChange?: (state: EngineSelectionState) => void;
  private readonly onMetrics?: (metrics: RenderMetrics) => void;
  private readonly onPointerCoordinate?: (
    coordinate: [number, number] | null
  ) => void;
  private readonly onMeasurementChange?: (state: MeasurementState) => void;
  private style = {...DEFAULT_STYLE};
  private ellipsesVisible = true;
  private selectedEllipsesVisible = true;
  private opacity = 1;
  private timeRange: [number, number] = [-Infinity, Infinity];
  private colorMode: 'source' | 'uniform' | 'time' = 'source';
  private colorPalette: ColorPalette = 'turbo';
  private lastMetricAt = 0;
  private selectedPixelMarks = new Uint16Array();
  private selectedPixelFrame = 0;
  private measurementEnabled = false;
  private baseSourceKey = 'osm';

  constructor(options: EngineOptions) {
    this.onSelectionChange = options.onSelectionChange;
    this.onMetrics = options.onMetrics;
    this.onPointerCoordinate = options.onPointerCoordinate;
    this.onMeasurementChange = options.onMeasurementChange;

    this.source = new ImageCanvasSource({
      ratio: 1,
      projection: 'EPSG:3857',
      canvasFunction: (extent, resolution, pixelRatio, size) =>
        this.render(
          extent as Extent,
          resolution,
          pixelRatio,
          size as [number, number]
        ),
    });
    this.layer = new ImageLayer({source: this.source});
    this.baseLayer = new TileLayer({
      source: new OSM({transition: 0}),
    });
    this.baseLayer.setZIndex(0);
    this.layer.setZIndex(10);
    const measurementColor = options.measurementColor ?? '#ef4444';
    const measurementStyleFunction = createMeasurementStyle(measurementColor);
    this.measurementLayer = new VectorLayer({
      source: this.measurementSource,
      style: measurementStyleFunction,
    });
    this.measurementLayer.setZIndex(30);
    this.countryLayers = createPackagedCountryLayers('#64748b');
    this.map = new OLMap({
      target: options.target,
      layers: [
        this.baseLayer,
        this.layer,
        this.measurementLayer,
        this.countryLayers.countries,
        this.countryLayers.hydrology,
      ],
      // The CSV/table selection contract reserves Ctrl/Cmd-drag for box
      // selection. Disable OpenLayers' competing Shift-drag zoom box so a
      // modifier drag can never be interpreted as a zoom gesture.
      interactions: defaultInteractions({shiftDragZoom: false}),
      view: new View({center: fromLonLat([0, 18]), zoom: 2}),
    });
    this.coordinateDisplay = installReferenceCoordinateDisplay(
      this.map,
      options.target
    );

    this.dragBox = this.installSelection();
    this.measurementDraw = this.installMeasurement(measurementStyleFunction);
    this.map.on('pointermove', (event) => {
      if (!this.onPointerCoordinate) return;
      const coordinate = event.coordinate;
      const longitude = (coordinate[0] / 20_037_508.342789244) * 180;
      const latitude =
        (Math.atan(Math.sinh(coordinate[1] / 6_378_137)) * 180) / Math.PI;
      this.onPointerCoordinate([longitude, latitude]);
    });
  }

  get count(): number {
    return this.x.length;
  }

  get visibleCount(): number {
    return this.nodeVisible[0] ?? 0;
  }

  get selectionCount(): number {
    return this.selectedCountValue;
  }

  /**
   * Returns the source row that should retain table focus as presentation
   * order changes. Selection identity always remains the source-row bitmask;
   * this ordinal is only a view hint and never defines membership.
   */
  get selectionFocusIndex(): number {
    if (
      this.selectionFocusIndexValue >= 0 &&
      this.isSelected(this.selectionFocusIndexValue)
    ) {
      return this.selectionFocusIndexValue;
    }
    this.selectionFocusIndexValue = this.firstSelectedIndex();
    return this.selectionFocusIndexValue;
  }

  get snapshot() {
    return {
      x: this.x,
      y: this.y,
      sma: this.semiMajor,
      smi: this.semiMinor,
      tilt: this.rotation,
      time: this.timestamps,
      colors: this.colors,
      visible: this.visible,
      selected: this.selected,
    };
  }

  loadDataset(
    dataset: PackedDataset,
    summary: DatasetSummary,
    savedState?: EngineDatasetState
  ): void {
    this.x = dataset.x;
    this.y = dataset.y;
    this.semiMajor = dataset.semiMajor;
    this.semiMinor = dataset.semiMinor;
    this.rotation = dataset.rotation;
    this.timestamps = dataset.time;
    this.colors = dataset.colors;
    this.spatial = dataset.index;
    this.dataExtent = dataset.extent;
    this.timeMinimum = summary.timeMin;
    this.timeMaximum = summary.timeMax;
    const restored =
      savedState &&
      savedState.visible.length === this.count &&
      savedState.deleted.length === this.count &&
      savedState.selected.length === this.count
        ? savedState
        : undefined;
    this.visible = restored ? restored.visible : new Uint8Array(this.count);
    if (!restored) this.visible.fill(1);
    this.manualVisible =
      restored?.manualVisible ??
      (restored ? restored.visible.slice() : new Uint8Array(this.count));
    if (!restored) this.manualVisible.fill(1);
    this.deleted = restored ? restored.deleted : new Uint8Array(this.count);
    this.selected = restored ? restored.selected : new Uint8Array(this.count);
    this.hasDeleted = false;
    if (restored) {
      for (let index = 0; index < this.count; index += 1) {
        if (this.deleted[index]) this.hasDeleted = true;
      }
    }
    this.timeRange = restored ? [...restored.timeRange] : [-Infinity, Infinity];
    this.nodeVisible = new Uint32Array(this.spatial.nodeStart.length);
    if (restored) {
      this.rebuildVisibility();
    } else {
      for (let node = 0; node < this.nodeVisible.length; node += 1) {
        this.nodeVisible[node] =
          this.spatial.nodeEnd[node] - this.spatial.nodeStart[node];
      }
    }
    this.nodeSelected = new Uint32Array(this.spatial.nodeStart.length);
    this.selectedCountValue = restored
      ? rebuildNodeSelectionCounts(
          this.spatial,
          this.selected,
          this.visible,
          this.deleted,
          this.nodeSelected
        )
      : 0;
    this.selectionFocusIndexValue = this.firstSelectedIndex();
    this.invalidate();
    this.emitSelection();
  }

  captureState(): EngineDatasetState {
    return {
      visible: this.visible,
      manualVisible: this.manualVisible,
      deleted: this.deleted,
      selected: this.selected,
      timeRange: [...this.timeRange],
    };
  }

  manualTimeHistogram(): Uint32Array<ArrayBuffer> {
    return buildMaskedTimeHistogram(
      this.timestamps,
      this.manualVisible,
      this.timeMinimum,
      this.timeMaximum
    );
  }

  setColors(colors: Uint32Array<ArrayBuffer>): void {
    if (colors.length !== this.count) {
      throw new Error(
        `Color column has ${colors.length.toLocaleString()} rows; expected ${this.count.toLocaleString()}.`
      );
    }
    this.colors = colors;
    this.colorMode = 'source';
    this.invalidate();
  }

  clear(): void {
    this.x = new Float64Array();
    this.y = new Float64Array();
    this.semiMajor = new Float32Array();
    this.semiMinor = new Float32Array();
    this.rotation = new Float32Array();
    this.timestamps = new Float64Array();
    this.colors = new Uint32Array();
    this.visible = new Uint8Array();
    this.manualVisible = new Uint8Array();
    this.deleted = new Uint8Array();
    this.selected = new Uint8Array();
    this.spatial = EMPTY_INDEX;
    this.nodeVisible = new Uint32Array();
    this.nodeSelected = new Uint32Array();
    this.dataExtent = [0, 0, 0, 0];
    this.timeMinimum = Number.NaN;
    this.timeMaximum = Number.NaN;
    this.timeRange = [-Infinity, Infinity];
    this.selectedCountValue = 0;
    this.selectionFocusIndexValue = -1;
    this.hasDeleted = false;
    this.invalidate();
    this.emitSelection();
  }

  setColorMode(mode: 'source' | 'uniform' | 'time'): void {
    this.colorMode = mode;
    this.invalidate();
  }

  setColorPalette(palette: ColorPalette): void {
    this.colorPalette = palette;
    this.invalidate();
  }

  setPointStyle(style: Partial<PointRenderStyle>): void {
    this.style = {...this.style, ...style};
    this.invalidate();
  }

  /** Sets the quadtree collapse threshold in CSS pixels. */
  setCollapsePixels(pixels: number): void {
    this.style.collapsePixels = Math.max(1, pixels);
    this.invalidate();
  }

  setEllipseStyle(style: Partial<EllipseRenderStyle>): void {
    this.style = {...this.style, ...style};
    this.invalidate();
  }

  /**
   * Applies a caller-owned row visibility mask without rebuilding features.
   * This is the browser equivalent of FastPointsLayer hide/show filtering.
   */
  setVisibilityMask(mask: Uint8Array): number {
    if (mask.length !== this.count) {
      throw new Error(
        `Visibility mask has ${mask.length.toLocaleString()} rows; expected ${this.count.toLocaleString()}.`
      );
    }
    this.manualVisible.set(mask);
    this.applyVisibilityFilters();
    let selectionChanged = false;
    for (let index = 0; index < this.count; index += 1) {
      if (this.visible[index] || !this.selected[index]) continue;
      this.selected[index] = 0;
      selectionChanged = true;
    }
    this.rebuildVisibility();
    if (selectionChanged) this.rebuildSelectionCounts();
    if (!this.isSelected(this.selectionFocusIndexValue)) {
      this.selectionFocusIndexValue = this.firstSelectedIndex();
    }
    this.invalidate();
    this.emitSelection();
    return this.visibleCount;
  }

  setTimeRange(start: number, end: number): number {
    this.timeRange = [start, end];
    this.applyVisibilityFilters();
    let selectionChanged = false;
    for (let index = 0; index < this.count; index += 1) {
      if (!this.visible[index] && this.selected[index]) {
        this.selected[index] = 0;
        selectionChanged = true;
      }
    }
    this.rebuildVisibility();
    if (selectionChanged) this.rebuildSelectionCounts();
    if (!this.isSelected(this.selectionFocusIndexValue)) {
      this.selectionFocusIndexValue = this.firstSelectedIndex();
    }
    this.invalidate();
    this.emitSelection();
    return this.visibleCount;
  }

  showAll(): void {
    this.timeRange = [-Infinity, Infinity];
    this.manualVisible.fill(1);
    this.visible.fill(1);
    if (this.hasDeleted) {
      this.rebuildVisibility();
    } else {
      for (let node = 0; node < this.nodeVisible.length; node += 1) {
        this.nodeVisible[node] =
          this.spatial.nodeEnd[node] - this.spatial.nodeStart[node];
      }
    }
    this.invalidate();
  }

  visibleIndices(): Uint32Array {
    const output = new Uint32Array(this.visibleCount);
    let cursor = 0;
    for (let index = 0; index < this.count; index += 1) {
      if (this.isVisible(index)) output[cursor++] = index;
    }
    return cursor === output.length ? output : output.slice(0, cursor);
  }

  hideSelection(): void {
    for (let index = 0; index < this.count; index += 1) {
      if (!this.selected[index]) continue;
      this.manualVisible[index] = 0;
      this.visible[index] = 0;
      this.selected[index] = 0;
    }
    this.clearSelectionState();
    this.rebuildVisibility();
    this.invalidate();
    this.emitSelection();
  }

  showOnlySelection(): void {
    this.manualVisible.fill(0);
    for (let index = 0; index < this.count; index += 1) {
      if (this.selected[index] && !this.deleted[index]) {
        this.manualVisible[index] = 1;
      }
    }
    this.applyVisibilityFilters();
    this.rebuildVisibility();
    this.invalidate();
  }

  deleteSelection(): void {
    for (let index = 0; index < this.count; index += 1) {
      if (!this.selected[index]) continue;
      this.deleted[index] = 1;
      this.manualVisible[index] = 0;
      this.visible[index] = 0;
      this.selected[index] = 0;
    }
    this.clearSelectionState();
    this.hasDeleted = true;
    this.rebuildVisibility();
    this.invalidate();
    this.emitSelection();
  }

  clearSelection(): void {
    if (!this.selectedCountValue) return;
    this.selected.fill(0);
    this.clearSelectionState();
    this.invalidate();
    this.emitSelection();
  }

  selectIndices(indices: Iterable<number>, replace = true): void {
    if (replace) {
      this.selected.fill(0);
      this.nodeSelected.fill(0);
      this.selectedCountValue = 0;
      this.selectionFocusIndexValue = -1;
    }
    let changed = 0;
    let rebuildCounts = false;
    for (const index of indices) {
      if (
        index < 0 ||
        index >= this.count ||
        !this.isVisible(index) ||
        this.selected[index]
      )
        continue;
      this.selected[index] = 1;
      this.selectionFocusIndexValue = index;
      this.selectedCountValue += 1;
      changed += 1;
      if (changed <= 4_096 && !rebuildCounts) {
        this.adjustSelectedPath(index, 1);
      } else {
        rebuildCounts = true;
      }
    }
    if (rebuildCounts) this.rebuildSelectionCounts();
    this.invalidate();
    this.emitSelection();
  }

  selectExtent(extent: Extent, replace = true): void {
    this.selectedCountValue = selectExtentIntoMask(
      this.spatial,
      this.x,
      this.y,
      this.selected,
      this.visible,
      this.deleted,
      this.nodeVisible,
      this.nodeSelected,
      extent,
      replace
    );
    this.selectionFocusIndexValue = this.firstSelectedIndex();
    this.invalidate();
    this.emitSelection();
  }

  toggleIndex(index: number): void {
    if (index < 0 || index >= this.count || !this.isVisible(index)) return;
    if (this.selected[index]) {
      this.selected[index] = 0;
      this.selectedCountValue -= 1;
      this.adjustSelectedPath(index, -1);
      if (this.selectionFocusIndexValue === index) {
        this.selectionFocusIndexValue = this.firstSelectedIndex();
      }
    } else {
      this.selected[index] = 1;
      this.selectedCountValue += 1;
      this.adjustSelectedPath(index, 1);
      this.selectionFocusIndexValue = index;
    }
    this.invalidate();
    this.emitSelection();
  }

  setEllipsesVisible(visible: boolean): void {
    this.ellipsesVisible = visible;
    this.invalidate();
  }

  setSelectedEllipsesVisible(visible: boolean): void {
    this.selectedEllipsesVisible = visible;
    this.invalidate();
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.invalidate();
  }

  setBaseVisible(visible: boolean): void {
    this.baseLayer.setVisible(visible);
  }

  setBaseOpacity(opacity: number): void {
    this.baseLayer.setOpacity(opacity);
  }

  setCountryBoundariesVisible(visible: boolean): void {
    void this.countryLayers.setVisible(visible).catch((error: unknown) => {
      console.error('Unable to load packaged country boundaries.', error);
    });
  }

  setCountryStrokeColor(color: string): void {
    this.countryLayers.setStrokeColor(color);
  }

  setMapBackgroundColor(color: string): void {
    this.map.getTargetElement().style.backgroundColor = color;
  }

  /** Replaces the base tile source without rebuilding the OpenLayers map. */
  setBaseLayer(definition: BaseLayerDefinition): void {
    const sourceKey = [
      definition.type,
      definition.url ?? '',
      definition.attribution ?? '',
      definition.maxZoom ?? '',
    ].join('\u0000');
    if (sourceKey === this.baseSourceKey) return;
    this.baseSourceKey = sourceKey;
    if (definition.type === 'osm') {
      this.baseLayer.setSource(new OSM({transition: 0}));
      return;
    }
    if (!definition.url) return;
    this.baseLayer.setSource(
      new XYZ({
        url: definition.url,
        attributions: definition.attribution,
        maxZoom: definition.maxZoom,
        transition: 0,
      })
    );
  }

  /**
   * Reconciles user-managed WMS and XYZ overlays. The point canvas retains a
   * higher z-index, so changing geographic context never rebuilds point data.
   */
  setManagedLayers(definitions: readonly ManagedLayerDefinition[]): void {
    const requestedIds = new Set(
      definitions.map((definition) => definition.id)
    );
    for (const [id, layer] of this.managedLayers) {
      if (requestedIds.has(id)) continue;
      this.map.removeLayer(layer);
      this.managedLayers.delete(id);
    }
    for (const [index, definition] of definitions.entries()) {
      const sourceKey = [
        definition.type,
        definition.url,
        definition.layers ?? '',
        definition.attribution ?? '',
      ].join('\u0000');
      const current = this.managedLayers.get(definition.id);
      if (current?.get('sourceKey') === sourceKey) {
        current.setVisible(definition.visible);
        current.setOpacity(definition.opacity);
        current.setZIndex(2 + index);
        continue;
      }
      if (current) this.map.removeLayer(current);
      const source =
        definition.type === 'wms'
          ? new TileWMS({
              url: definition.url,
              params: {
                LAYERS: definition.layers ?? '',
                TILED: true,
              },
              transition: 0,
            })
          : new XYZ({
              url: definition.url,
              attributions: definition.attribution,
              transition: 0,
            });
      const layer = new TileLayer({source});
      layer.set('sourceKey', sourceKey);
      layer.setVisible(definition.visible);
      layer.setOpacity(definition.opacity);
      layer.setZIndex(2 + index);
      this.managedLayers.set(definition.id, layer);
      this.map.addLayer(layer);
    }
  }

  setMeasurementEnabled(enabled: boolean): void {
    this.measurementEnabled = enabled;
    this.measurementDraw.setActive(enabled);
    this.dragBox.setActive(!enabled);
    this.map.getTargetElement().classList.toggle('is-measuring', enabled);
  }

  clearMeasurements(): void {
    this.measurementSource.clear();
    this.onMeasurementChange?.({
      pointCount: 0,
      segmentMeters: [],
      totalMeters: 0,
    });
  }

  fitToData(): void {
    if (!this.count) return;
    this.map.getView().fit(this.dataExtent, {
      padding: [50, 50, 50, 50],
      maxZoom: 12,
      duration: 250,
    });
  }

  dispose(): void {
    this.coordinateDisplay.dispose();
    this.map.setTarget(undefined);
  }

  row(index: number) {
    const x = this.x[index];
    const y = this.y[index];
    return {
      index,
      longitude: (x / 20_037_508.342789244) * 180,
      latitude: (Math.atan(Math.sinh(y / 6_378_137)) * 180) / Math.PI,
      time: this.timestamps[index],
      semiMajor: this.semiMajor[index],
      semiMinor: this.semiMinor[index],
      tilt: 90 - (this.rotation[index] * 180) / Math.PI,
    };
  }

  isSelected(index: number): boolean {
    return index >= 0 && index < this.count && this.selected[index] === 1;
  }

  *selectedIndices(): Generator<number> {
    for (let index = 0; index < this.count; index += 1) {
      if (this.selected[index]) yield index;
    }
  }

  private applyVisibilityFilters(): void {
    const [start, end] = this.timeRange;
    for (let index = 0; index < this.count; index += 1) {
      const timestamp = this.timestamps[index];
      const inTimeRange =
        !Number.isFinite(timestamp) || (timestamp >= start && timestamp <= end);
      this.visible[index] = this.manualVisible[index] && inTimeRange ? 1 : 0;
    }
  }

  private isVisible(index: number): boolean {
    return this.visible[index] === 1 && this.deleted[index] === 0;
  }

  private nodeIntersects(node: number, extent: Extent): boolean {
    return !(
      this.spatial.nodeMaxX[node] < extent[0] ||
      this.spatial.nodeMinX[node] > extent[2] ||
      this.spatial.nodeMaxY[node] < extent[1] ||
      this.spatial.nodeMinY[node] > extent[3]
    );
  }

  private pointInExtent(index: number, extent: Extent): boolean {
    return (
      this.x[index] >= extent[0] &&
      this.x[index] <= extent[2] &&
      this.y[index] >= extent[1] &&
      this.y[index] <= extent[3]
    );
  }

  private pointIntersectsRenderExtent(index: number, extent: Extent): boolean {
    const wrappedX = wrapXForExtent(this.x[index], extent);
    const ellipseRadius = Math.max(
      this.semiMajor[index],
      this.semiMinor[index]
    );
    return (
      wrappedX >= extent[0] - ellipseRadius &&
      wrappedX <= extent[2] + ellipseRadius &&
      this.y[index] >= extent[1] - ellipseRadius &&
      this.y[index] <= extent[3] + ellipseRadius
    );
  }

  private isLeaf(node: number): boolean {
    return (
      this.spatial.nodeChildren[node * 4] < 0 &&
      this.spatial.nodeChildren[node * 4 + 1] < 0 &&
      this.spatial.nodeChildren[node * 4 + 2] < 0 &&
      this.spatial.nodeChildren[node * 4 + 3] < 0
    );
  }

  private pushChildren(stack: number[], node: number): void {
    const base = node * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      const child = this.spatial.nodeChildren[base + slot];
      if (child >= 0) stack.push(child);
    }
  }

  private rebuildVisibility(): void {
    for (let node = this.nodeVisible.length - 1; node >= 0; node -= 1) {
      if (!this.isLeaf(node)) {
        let total = 0;
        const base = node * 4;
        for (let slot = 0; slot < 4; slot += 1) {
          const child = this.spatial.nodeChildren[base + slot];
          if (child >= 0) total += this.nodeVisible[child];
        }
        this.nodeVisible[node] = total;
        continue;
      }
      let total = 0;
      for (
        let offset = this.spatial.nodeStart[node];
        offset < this.spatial.nodeEnd[node];
        offset += 1
      ) {
        total += this.isVisible(this.spatial.order[offset]) ? 1 : 0;
      }
      this.nodeVisible[node] = total;
    }
  }

  private clearSelectionState(): void {
    this.selectedCountValue = 0;
    this.nodeSelected.fill(0);
    this.selectionFocusIndexValue = -1;
  }

  private rebuildSelectionCounts(): void {
    this.selectedCountValue = rebuildNodeSelectionCounts(
      this.spatial,
      this.selected,
      this.visible,
      this.deleted,
      this.nodeSelected
    );
  }

  /**
   * Finds one selected source row through compact node counts. This keeps
   * table-focus restoration logarithmic even when millions of rows are
   * selected, and avoids materializing a selected-index collection.
   */
  private firstSelectedIndex(): number {
    if (!this.selectedCountValue || !this.nodeSelected.length) return -1;
    let node = 0;
    while (!this.isLeaf(node)) {
      const base = node * 4;
      let next = -1;
      for (let slot = 0; slot < 4; slot += 1) {
        const child = this.spatial.nodeChildren[base + slot];
        if (child >= 0 && this.nodeSelected[child] > 0) {
          next = child;
          break;
        }
      }
      if (next < 0) return -1;
      node = next;
    }
    for (
      let offset = this.spatial.nodeStart[node];
      offset < this.spatial.nodeEnd[node];
      offset += 1
    ) {
      const index = this.spatial.order[offset];
      if (this.isSelected(index)) return index;
    }
    return -1;
  }

  private adjustSelectedPath(index: number, delta: 1 | -1): void {
    if (!this.nodeSelected.length) return;
    let node = 0;
    while (node >= 0) {
      this.nodeSelected[node] =
        delta > 0
          ? this.nodeSelected[node] + 1
          : Math.max(0, this.nodeSelected[node] - 1);
      if (this.isLeaf(node)) return;
      const midX =
        (this.spatial.nodeMinX[node] + this.spatial.nodeMaxX[node]) * 0.5;
      const midY =
        (this.spatial.nodeMinY[node] + this.spatial.nodeMaxY[node]) * 0.5;
      const slot =
        (this.x[index] >= midX ? 1 : 0) + (this.y[index] >= midY ? 2 : 0);
      node = this.spatial.nodeChildren[node * 4 + slot];
    }
  }

  private nearestPoint(coordinate: [number, number], radius: number): number {
    if (!this.nodeVisible.length) return -1;
    const extent: Extent = [
      coordinate[0] - radius,
      coordinate[1] - radius,
      coordinate[0] + radius,
      coordinate[1] + radius,
    ];
    let best = -1;
    let bestDistance = radius * radius;
    for (const queryExtent of renderQueryExtents(extent)) {
      const stack = [0];
      while (stack.length) {
        const node = stack.pop()!;
        if (
          this.nodeVisible[node] <= 0 ||
          !this.nodeIntersects(node, queryExtent)
        ) {
          continue;
        }
        if (!this.isLeaf(node)) {
          this.pushChildren(stack, node);
          continue;
        }
        for (
          let offset = this.spatial.nodeStart[node];
          offset < this.spatial.nodeEnd[node];
          offset += 1
        ) {
          const index = this.spatial.order[offset];
          if (!this.isVisible(index)) continue;
          const x = wrapXForExtent(this.x[index], extent);
          const dx = x - coordinate[0];
          const dy = this.y[index] - coordinate[1];
          const distance = dx * dx + dy * dy;
          if (distance <= bestDistance) {
            best = index;
            bestDistance = distance;
          }
        }
      }
    }
    return best;
  }

  private installSelection(): DragBox {
    this.map.on('singleclick', (event) => {
      if (this.measurementEnabled) return;
      const original = event.originalEvent as MouseEvent;
      const resolution = this.map.getView().getResolution() ?? 1;
      const index = this.nearestPoint(
        event.coordinate as [number, number],
        Math.max(5, resolution * 9)
      );
      if (index < 0) {
        if (!original.ctrlKey && !original.metaKey) this.clearSelection();
        return;
      }
      if (!original.ctrlKey && !original.metaKey) {
        this.selectIndices([index], true);
        return;
      }
      this.toggleIndex(index);
    });

    const dragBox = new DragBox({condition: modifierBoxSelection});
    this.map.addInteraction(dragBox);
    dragBox.on('boxend', () => {
      const extent = dragBox.getGeometry().getExtent() as Extent;
      this.selectExtent(extent, true);
    });
    return dragBox;
  }

  private installMeasurement(style: StyleFunction): Draw {
    const draw = new Draw({
      source: this.measurementSource,
      type: 'LineString',
      style,
    });
    draw.setActive(false);
    this.map.addInteraction(draw);
    draw.on('drawstart', (event) => {
      this.measurementSource.clear();
      const geometry = event.feature.getGeometry();
      if (!(geometry instanceof LineString)) return;
      geometry.on('change', () =>
        this.emitMeasurement(geometry.getCoordinates())
      );
      this.emitMeasurement(geometry.getCoordinates());
    });
    draw.on('drawend', (event) => {
      const geometry = event.feature.getGeometry();
      if (geometry instanceof LineString)
        this.emitMeasurement(geometry.getCoordinates());
    });
    return draw;
  }

  private emitMeasurement(coordinates: number[][]): void {
    if (!this.onMeasurementChange) return;
    const segmentMeters: number[] = [];
    for (let index = 1; index < coordinates.length; index += 1) {
      segmentMeters.push(
        getDistance(
          toLonLat(coordinates[index - 1]),
          toLonLat(coordinates[index])
        )
      );
    }
    this.onMeasurementChange({
      pointCount: coordinates.length,
      segmentMeters,
      totalMeters: segmentMeters.reduce(
        (total, distance) => total + distance,
        0
      ),
    });
  }

  private emitSelection(): void {
    if (!this.onSelectionChange) return;
    this.selectionRevision += 1;
    this.onSelectionChange({
      count: this.selectedCountValue,
      revision: this.selectionRevision,
    });
  }

  private invalidate(): void {
    this.source.changed();
    this.map.render();
  }

  private representative(
    node: number,
    extent: Extent,
    selectionState?: 0 | 1
  ): number {
    if (this.nodeVisible[node] <= 0) return -1;
    if (selectionState === 1 && this.nodeSelected[node] <= 0) return -1;
    if (
      selectionState === 0 &&
      this.nodeVisible[node] - this.nodeSelected[node] <= 0
    )
      return -1;
    const firstIndex = this.spatial.nodeFirstIndex[node];
    if (
      firstIndex !== 0xffffffff &&
      this.isVisible(firstIndex) &&
      (selectionState == null ||
        this.selected[firstIndex] === selectionState) &&
      this.pointInExtent(firstIndex, extent)
    ) {
      return firstIndex;
    }
    if (!this.isLeaf(node)) {
      const base = node * 4;
      for (let slot = 0; slot < 4; slot += 1) {
        const child = this.spatial.nodeChildren[base + slot];
        if (
          child < 0 ||
          this.nodeVisible[child] <= 0 ||
          !this.nodeIntersects(child, extent)
        ) {
          continue;
        }
        const result = this.representative(child, extent, selectionState);
        if (result >= 0) return result;
      }
      return -1;
    }
    const start = this.spatial.nodeStart[node];
    const end = this.spatial.nodeEnd[node];
    for (let offset = start; offset < end; offset += 1) {
      const index = this.spatial.order[offset];
      if (
        this.isVisible(index) &&
        (selectionState == null || this.selected[index] === selectionState) &&
        this.pointInExtent(index, extent)
      ) {
        return index;
      }
    }
    return -1;
  }

  private pointColor(index: number): number {
    if (this.colorMode === 'uniform') return this.style.defaultColor;
    if (this.colorMode === 'source') {
      return this.colors[index] || this.style.defaultColor;
    }
    const value = this.timestamps[index];
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(this.timeMinimum) ||
      !Number.isFinite(this.timeMaximum)
    ) {
      return 0x64748bdd;
    }
    const span = Math.max(1, this.timeMaximum - this.timeMinimum);
    const normalized = Math.max(
      0,
      Math.min(1, (value - this.timeMinimum) / span)
    );
    return gradientColor(normalized, this.colorPalette, 224);
  }

  private render(
    extent: Extent,
    resolution: number,
    pixelRatio: number,
    size: [number, number]
  ): HTMLCanvasElement {
    const started = performance.now();
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = imageCanvasPixelSize(size);
    const context = canvas.getContext('2d');
    if (!context || this.count === 0 || !this.nodeVisible.length) return canvas;

    const scaleX = canvas.width / (extent[2] - extent[0]);
    const scaleY = canvas.height / (extent[3] - extent[1]);
    const collapsePixels = this.style.collapsePixels * pixelRatio;
    const queryExtents = renderQueryExtents(extent);
    const drawIndices: number[] = [];
    const selectedDrawIndices: number[] = [];
    const seenPixels = new Set<string>();
    let selectedPixelFrame = 0;
    if (this.selectedCountValue) {
      const pixelCount = canvas.width * canvas.height;
      if (this.selectedPixelMarks.length < pixelCount) {
        this.selectedPixelMarks = new Uint16Array(pixelCount);
      }
      this.selectedPixelFrame = (this.selectedPixelFrame + 1) & 0xffff;
      if (this.selectedPixelFrame === 0) {
        this.selectedPixelMarks.fill(0);
        this.selectedPixelFrame = 1;
      }
      selectedPixelFrame = this.selectedPixelFrame;
    }
    let visitedNodes = 0;
    let collapsedNodes = 0;

    const addIndex = (index: number): void => {
      if (
        !this.isVisible(index) ||
        !this.pointIntersectsRenderExtent(index, extent)
      ) {
        return;
      }
      const wrappedX = wrapXForExtent(this.x[index], extent);
      const px = Math.round((wrappedX - extent[0]) * scaleX);
      const py = Math.round((extent[3] - this.y[index]) * scaleY);
      const isSelected = this.selected[index] === 1;
      const color = isSelected
        ? this.style.selectedColor
        : this.pointColor(index);
      const radius =
        (isSelected ? this.style.selectedRadius : this.style.radius) *
        pixelRatio;
      if (isSelected) {
        if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height)
          return;
        const pixelOffset = py * canvas.width + px;
        if (this.selectedPixelMarks[pixelOffset] === selectedPixelFrame) return;
        this.selectedPixelMarks[pixelOffset] = selectedPixelFrame;
        selectedDrawIndices.push(index);
        return;
      }
      const key = `${color}|${radius}|${px}|${py}`;
      if (seenPixels.has(key)) return;
      seenPixels.add(key);
      drawIndices.push(index);
    };

    for (const queryExtent of queryExtents) {
      const stack = [0];
      while (stack.length) {
        const node = stack.pop()!;
        if (
          this.nodeVisible[node] <= 0 ||
          !this.nodeIntersects(node, queryExtent)
        ) {
          continue;
        }
        visitedNodes += 1;
        const widthPx =
          ((this.spatial.nodeMaxX[node] - this.spatial.nodeMinX[node]) /
            resolution) *
          pixelRatio;
        const heightPx =
          ((this.spatial.nodeMaxY[node] - this.spatial.nodeMinY[node]) /
            resolution) *
          pixelRatio;
        if (widthPx <= collapsePixels && heightPx <= collapsePixels) {
          const unselectedIndex = this.representative(node, queryExtent, 0);
          const selectedIndex = this.representative(node, queryExtent, 1);
          if (unselectedIndex >= 0) {
            collapsedNodes += 1;
            addIndex(unselectedIndex);
          }
          if (selectedIndex >= 0) {
            collapsedNodes += 1;
            addIndex(selectedIndex);
          }
          continue;
        }
        if (!this.isLeaf(node)) {
          this.pushChildren(stack, node);
          continue;
        }
        const start = this.spatial.nodeStart[node];
        const end = this.spatial.nodeEnd[node];
        for (let offset = start; offset < end; offset += 1) {
          addIndex(this.spatial.order[offset]);
        }
      }
    }

    let drawnEllipses = 0;
    if (this.ellipsesVisible || this.selectedEllipsesVisible) {
      const ellipseBatches = new Map<
        string,
        {color: number; selected: boolean; indices: number[]}
      >();
      const collectEllipse = (index: number, selected: boolean): void => {
        if (
          (selected && !this.selectedEllipsesVisible) ||
          (!selected && !this.ellipsesVisible)
        ) {
          return;
        }
        const color = selected
          ? (this.style.selectedEllipseColor ?? this.style.selectedColor)
          : (this.style.ellipseColor ?? this.pointColor(index));
        const key = `${color}|${selected ? 1 : 0}`;
        let batch = ellipseBatches.get(key);
        if (!batch) {
          batch = {color, selected, indices: []};
          ellipseBatches.set(key, batch);
        }
        batch.indices.push(index);
      };
      for (const index of drawIndices) collectEllipse(index, false);
      for (const index of selectedDrawIndices) collectEllipse(index, true);

      for (const batch of ellipseBatches.values()) {
        context.strokeStyle = colorToCss(batch.color, this.opacity);
        context.fillStyle = colorToCss(
          withAlpha(batch.color, this.style.ellipseFillAlpha),
          this.opacity
        );
        context.lineWidth =
          this.style.ellipseWidth * (batch.selected ? 1.8 : 1) * pixelRatio;
        context.beginPath();
        for (const index of batch.indices) {
          const radiusX = (this.semiMajor[index] / resolution) * pixelRatio;
          const radiusY = (this.semiMinor[index] / resolution) * pixelRatio;
          if (
            radiusX < this.style.minEllipsePixels &&
            radiusY < this.style.minEllipsePixels
          )
            continue;
          const wrappedX = wrapXForExtent(this.x[index], extent);
          const x = (wrappedX - extent[0]) * scaleX;
          const y = (extent[3] - this.y[index]) * scaleY;
          const rotation = this.rotation[index];
          context.moveTo(
            x + radiusX * Math.cos(rotation),
            y + radiusX * Math.sin(rotation)
          );
          context.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
          drawnEllipses += 1;
        }
        // ol_bridge.js intentionally leaves selected ellipses unfilled so
        // dense selections remain legible.
        if (!batch.selected && this.style.ellipseFillAlpha > 0) context.fill();
        context.stroke();
      }
    }

    const pointBatches = new Map<number, {radius: number; points: number[]}>();
    const collectPoint = (index: number, selected: boolean): void => {
      const color = selected
        ? this.style.selectedColor
        : this.pointColor(index);
      const radius =
        (selected ? this.style.selectedRadius : this.style.radius) * pixelRatio;
      const key = (color >>> 0) * 1_000 + Math.round(radius * 10);
      let batch = pointBatches.get(key);
      if (!batch) {
        batch = {radius, points: []};
        pointBatches.set(key, batch);
      }
      const wrappedX = wrapXForExtent(this.x[index], extent);
      batch.points.push(
        (wrappedX - extent[0]) * scaleX,
        (extent[3] - this.y[index]) * scaleY,
        color
      );
    };
    for (const index of drawIndices) collectPoint(index, false);
    for (const index of selectedDrawIndices) collectPoint(index, true);
    for (const batch of pointBatches.values()) {
      const color = batch.points[2];
      context.fillStyle = colorToCss(color, this.opacity);
      context.beginPath();
      for (let offset = 0; offset < batch.points.length; offset += 3) {
        const x = batch.points[offset];
        const y = batch.points[offset + 1];
        context.moveTo(x + batch.radius, y);
        context.arc(x, y, batch.radius, 0, Math.PI * 2);
      }
      context.fill();
    }

    const now = performance.now();
    if (this.onMetrics && now - this.lastMetricAt > 200) {
      this.lastMetricAt = now;
      this.onMetrics({
        totalPoints: this.count,
        visiblePoints: this.visibleCount,
        visitedNodes,
        collapsedNodes,
        drawnPoints: drawIndices.length + selectedDrawIndices.length,
        drawnEllipses,
        renderMs: now - started,
      });
    }
    return canvas;
  }
}
