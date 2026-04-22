import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// ── Renderer runtime diagnostics ──────────────────────────────────────────────
// Logs are forwarded to the main-process log file via wc.on('console-message').
window.onerror = (msg, source, line, col, error) => {
  console.error('[SADIK][UncaughtError]', String(msg), { source, line, col, stack: error?.stack });
};
window.onunhandledrejection = (e) => {
  console.error('[SADIK][UnhandledRejection]', e.reason);
};

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
