import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { retireLegacyStaffBrowserState } from './lib/staff-release.ts'
import './index.css'

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Staff's shell is deliberately network-current and its JS/CSS is hashed.
// Retire the old caching worker instead of re-registering it on every load.
window.addEventListener('load', () => { void retireLegacyStaffBrowserState(); });
