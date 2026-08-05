import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { UseCasesApp } from './UseCasesApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UseCasesApp />
  </StrictMode>
)
