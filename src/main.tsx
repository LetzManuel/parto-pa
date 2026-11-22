import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { openStore } from './platform/db';
import { App } from './ui/App';
import { loadDemo } from './ui/demo';

openStore().then((store) => {
  // Preview builds (VITE_PREVIEW_DEMO=1) open with example data once, so the first view shows what PA does.
  if (import.meta.env.VITE_PREVIEW_DEMO === '1' && !store.getMeta('demoLoaded') && store.list('order').length === 0) {
    loadDemo(store);
    store.setMeta('demoLoaded', '1');
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
});

// Installed on the home screen it should open offline too (not in dev, not in the one-file preview).
if (import.meta.env.PROD && import.meta.env.VITE_PREVIEW_DEMO !== '1' && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* no offline shell, app still works */ });
}
