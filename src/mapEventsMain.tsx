import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'ol/ol.css'
import { MapRightClickExampleApp } from './demos/MapRightClickExampleApp'
import { ModifiedMapClicksExampleApp } from './demos/ModifiedMapClicksExampleApp'
import './styles.css'
import './demos/demo.css'

const example = new URLSearchParams(window.location.search).get('example')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {example === '17' ? (
      <MapRightClickExampleApp />
    ) : example === '22' ? (
      <ModifiedMapClicksExampleApp />
    ) : (
      <MapRightClickExampleApp />
    )}
  </StrictMode>
)
