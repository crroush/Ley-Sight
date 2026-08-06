import {lazy, type ComponentType, type LazyExoticComponent} from 'react';
import {USE_CASES, type ParityStatus} from '../examples/data/useCases';

type RouteComponent = ComponentType | LazyExoticComponent<ComponentType>;

function lazyRoute(load: () => Promise<ComponentType>): RouteComponent {
  return lazy(async () => ({default: await load()}));
}

const UseCasesApp = lazyRoute(async () =>
  import('../UseCasesApp').then((module) => module.UseCasesApp)
);
const CsvWorkspaceApp = lazyRoute(async () =>
  import('../apps/csv/CsvWorkspaceApp').then((module) => module.CsvWorkspaceApp)
);
const BasicMapExampleApp = lazyRoute(async () =>
  import('../demos/BasicMapExampleApp').then(
    (module) => module.BasicMapExampleApp
  )
);
const DelayedRasterExampleApp = lazyRoute(async () =>
  import('../demos/DelayedRasterExampleApp').then(
    (module) => module.DelayedRasterExampleApp
  )
);
const FastPointsPerformanceExampleApp = lazyRoute(async () =>
  import('../demos/FastPointsExamples').then(
    (module) => module.FastPointsPerformanceExampleApp
  )
);
const GeoUncertaintyExampleApp = lazyRoute(async () =>
  import('../demos/FastPointsExamples').then(
    (module) => module.GeoUncertaintyExampleApp
  )
);
const FilteringDemoApp = lazyRoute(async () =>
  import('../demos/FilteringDemoApp').then((module) => module.FilteringDemoApp)
);
const GradientTracksExampleApp = lazyRoute(async () =>
  import('../demos/GradientTracksExampleApp').then(
    (module) => module.GradientTracksExampleApp
  )
);
const LayerManagerExampleApp = lazyRoute(async () =>
  import('../demos/LayerManagerExampleApp').then(
    (module) => module.LayerManagerExampleApp
  )
);
const LayerTypesExampleApp = lazyRoute(async () =>
  import('../demos/LayerTypesExampleApp').then(
    (module) => module.LayerTypesExampleApp
  )
);
const DualTableLinkingExampleApp = lazyRoute(async () =>
  import('../demos/LinkedTableExamples').then(
    (module) => module.DualTableLinkingExampleApp
  )
);
const MetadataOnlyLinkingExampleApp = lazyRoute(async () =>
  import('../demos/LinkedTableExamples').then(
    (module) => module.MetadataOnlyLinkingExampleApp
  )
);
const MapRightClickExampleApp = lazyRoute(async () =>
  import('../demos/MapRightClickExampleApp').then(
    (module) => module.MapRightClickExampleApp
  )
);
const ModifiedMapClicksExampleApp = lazyRoute(async () =>
  import('../demos/ModifiedMapClicksExampleApp').then(
    (module) => module.ModifiedMapClicksExampleApp
  )
);
const MovableVectorExampleApp = lazyRoute(async () =>
  import('../demos/MovableVectorExampleApp').then(
    (module) => module.MovableVectorExampleApp
  )
);
const RasterOverlayExampleApp = lazyRoute(async () =>
  import('../demos/RasterOverlayExampleApp').then(
    (module) => module.RasterOverlayExampleApp
  )
);
const FeatureSelectionExampleApp = lazyRoute(async () =>
  import('../demos/SelectionExamples').then(
    (module) => module.FeatureSelectionExampleApp
  )
);
const SelectionRecolorExampleApp = lazyRoute(async () =>
  import('../demos/SelectionExamples').then(
    (module) => module.SelectionRecolorExampleApp
  )
);
const TimeHistogramExampleApp = lazyRoute(async () =>
  import('../demos/TableExamples').then(
    (module) => module.TimeHistogramExampleApp
  )
);
const VirtualFeatureTableExampleApp = lazyRoute(async () =>
  import('../demos/TableExamples').then(
    (module) => module.VirtualFeatureTableExampleApp
  )
);
const TableIntegrationExampleApp = lazyRoute(async () =>
  import('../demos/TableIntegrationExampleApp').then(
    (module) => module.TableIntegrationExampleApp
  )
);
const CoordinateDisplayExampleApp = lazyRoute(async () =>
  import('../demos/UtilityExamples').then(
    (module) => module.CoordinateDisplayExampleApp
  )
);
const FitToDataExampleApp = lazyRoute(async () =>
  import('../demos/UtilityExamples').then(
    (module) => module.FitToDataExampleApp
  )
);
const MeasurementExampleApp = lazyRoute(async () =>
  import('../demos/UtilityExamples').then(
    (module) => module.MeasurementExampleApp
  )
);

export type AppShellId =
  | 'launcher'
  | 'csv'
  | 'vector'
  | 'raster'
  | 'filtering'
  | 'linked-tables'
  | 'map-events';

export type RouteId = AppShellId | `example-${number}`;

export type DemoMetadata = {
  example: string;
  href: string;
  status: ParityStatus;
};

export type RouteEntry = {
  id: RouteId;
  shell: AppShellId;
  label: string;
  description: string;
  component: RouteComponent;
  example?: string;
  demo?: DemoMetadata;
};

const shellRoutes: readonly RouteEntry[] = [
  {
    id: 'launcher',
    shell: 'launcher',
    label: 'LeySight examples',
    description:
      'Browse the LeySight application shells and reference workflows.',
    component: UseCasesApp,
  },
  {
    id: 'csv',
    shell: 'csv',
    label: 'CSV data lab',
    description: 'Import, inspect, filter, and map tabular geospatial data.',
    component: CsvWorkspaceApp,
  },
  {
    id: 'vector',
    shell: 'vector',
    label: 'Vector geometry',
    description: 'Explore vector geometry, styling, and selection.',
    component: BasicMapExampleApp,
  },
  {
    id: 'raster',
    shell: 'raster',
    label: 'Raster processing',
    description: 'Explore georeferenced raster overlays and masks.',
    component: RasterOverlayExampleApp,
  },
  {
    id: 'filtering',
    shell: 'filtering',
    label: 'Numeric and time filtering',
    description:
      'Filter synchronized map and table data by numeric and time ranges.',
    component: FilteringDemoApp,
  },
  {
    id: 'linked-tables',
    shell: 'linked-tables',
    label: 'Linked map and tables',
    description: 'Explore selection shared by maps and related tables.',
    component: DualTableLinkingExampleApp,
  },
  {
    id: 'map-events',
    shell: 'map-events',
    label: 'Map events',
    description: 'Explore context-menu and modifier-aware map events.',
    component: MapRightClickExampleApp,
  },
];

const exampleComponents: Record<number, RouteComponent> = {
  1: BasicMapExampleApp,
  2: LayerTypesExampleApp,
  3: FastPointsPerformanceExampleApp,
  4: LayerManagerExampleApp,
  5: RasterOverlayExampleApp,
  6: GeoUncertaintyExampleApp,
  7: FeatureSelectionExampleApp,
  8: TableIntegrationExampleApp,
  9: SelectionRecolorExampleApp,
  10: FilteringDemoApp,
  11: MeasurementExampleApp,
  12: CoordinateDisplayExampleApp,
  13: DualTableLinkingExampleApp,
  14: DelayedRasterExampleApp,
  15: FitToDataExampleApp,
  16: MetadataOnlyLinkingExampleApp,
  17: MapRightClickExampleApp,
  18: GradientTracksExampleApp,
  19: VirtualFeatureTableExampleApp,
  20: TimeHistogramExampleApp,
  21: MovableVectorExampleApp,
  22: ModifiedMapClicksExampleApp,
};

function shellFromHref(href: string): AppShellId {
  const path = href.split('?')[0];
  const shell = shellRoutes.find((route) => path.endsWith(`${route.id}.html`));
  if (shell) return shell.shell;
  if (path === '/linked-tables.html') return 'linked-tables';
  if (path === '/events.html') return 'map-events';
  throw new Error(`No app shell registered for ${href}`);
}

const exampleRoutes: readonly RouteEntry[] = USE_CASES.map((useCase) => ({
  id: `example-${useCase.id}`,
  shell: shellFromHref(useCase.href),
  label: useCase.example,
  description: useCase.capability,
  component: exampleComponents[useCase.id],
  example: String(useCase.id).padStart(2, '0'),
  demo: {
    example: useCase.webSurface,
    href: useCase.href,
    status: useCase.status,
  },
}));

export const routeRegistry: readonly RouteEntry[] = [
  ...shellRoutes,
  ...exampleRoutes,
];

export function resolveRoute(shell: AppShellId, search = ''): RouteEntry {
  const example = new URLSearchParams(search).get('example');
  return (
    routeRegistry.find(
      (route) => route.shell === shell && route.example === example
    ) ?? routeRegistry.find((route) => route.id === shell)!
  );
}
