import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'ol/ol.css'
import { FilteringDemoApp } from './demos/FilteringDemoApp'
import './styles.css'
import './demos/demo.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FilteringDemoApp />
  </StrictMode>
)
