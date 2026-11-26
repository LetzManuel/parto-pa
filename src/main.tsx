import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { openStore } from './platform/db';
import { App } from './ui/App';

openStore().then((store) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
});
