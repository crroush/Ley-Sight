import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import 'ol/ol.css';
import {RasterOverlayExampleApp} from './demos/RasterOverlayExampleApp';
import {DelayedRasterExampleApp} from './demos/DelayedRasterExampleApp';
import './styles.css';
import './demos/demo.css';

const example = new URLSearchParams(window.location.search).get('example');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {example === '14' ? (
      <DelayedRasterExampleApp />
    ) : (
      <RasterOverlayExampleApp />
    )}
  </StrictMode>
);
