import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../../renderer/ui/tokens.css';
import './styles.css';
import { App } from './App';

const prefersLight =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: light)').matches;
document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark';

const root = document.getElementById('root');
if (root === null) throw new Error('Web share root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
