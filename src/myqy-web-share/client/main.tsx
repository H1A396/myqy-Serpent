import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../../renderer/ui/tokens.css';
import './styles.css';
import { App } from './App';
import { PREFERS_CHINESE } from './i18n';

const prefersLight =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: light)').matches;
document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark';
// The client picks its language from navigator.language, so <html lang> must
// follow it too: a hardcoded zh-CN misleads screen readers and hyphenation when
// an English speaker opens the share. Set here (not in an inline <script>) so
// the entry document needs no inline script and can stay under `script-src
// 'self'`.
document.documentElement.lang = PREFERS_CHINESE ? 'zh-CN' : 'en';

const root = document.getElementById('root');
if (root === null) throw new Error('Web share root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
