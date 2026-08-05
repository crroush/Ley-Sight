import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'ol/ol.css'
import {
  DualTableLinkingExampleApp,
  MetadataOnlyLinkingExampleApp,
} from './demos/LinkedTableExamples'
import './styles.css'
import './demos/demo.css'

const example = new URLSearchParams(window.location.search).get('example')

function LinkedTablesEntry() {
  if (example === '13') return <DualTableLinkingExampleApp />
  if (example === '16') return <MetadataOnlyLinkingExampleApp />
  return <DualTableLinkingExampleApp />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LinkedTablesEntry />
  </StrictMode>
)
