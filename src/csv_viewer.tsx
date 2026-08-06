import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import 'ol/ol.css';
import './styles.css';
import './demos/demo.css';
import {CsvWorkspaceApp} from './apps/csv/CsvWorkspaceApp';
import {
  CoordinateDisplayExampleApp,
  FitToDataExampleApp,
  MeasurementExampleApp,
} from './demos/UtilityExamples';
import {LayerManagerExampleApp} from './demos/LayerManagerExampleApp';
import {
  TimeHistogramExampleApp,
  VirtualFeatureTableExampleApp,
} from './demos/TableExamples';
import {TableIntegrationExampleApp} from './demos/TableIntegrationExampleApp';

const example = new URLSearchParams(window.location.search).get('example');

function CsvEntry() {
  if (example === '04') return <LayerManagerExampleApp />;
  if (example === '08') return <TableIntegrationExampleApp />;
  if (example === '11') return <MeasurementExampleApp />;
  if (example === '12') return <CoordinateDisplayExampleApp />;
  if (example === '15') return <FitToDataExampleApp />;
  if (example === '19') return <VirtualFeatureTableExampleApp />;
  if (example === '20') return <TimeHistogramExampleApp />;
  return <CsvWorkspaceApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CsvEntry />
  </StrictMode>
);
