import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import type {AppShellId} from '../../routes/routeRegistry';
import {resolveRoute} from '../../routes/routeRegistry';

export function mountRoute(shell: AppShellId) {
  const route = resolveRoute(shell, window.location.search);
  const EntryComponent = route.component;

  document.title = route.label;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <EntryComponent />
    </StrictMode>
  );
}
