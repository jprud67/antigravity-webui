import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-recover if a new production build replaced hashed dynamic chunks
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  window.location.reload();
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = String(event.reason || '');
  if (reason.includes('Failed to fetch dynamically imported module') || reason.includes('dynamically imported module')) {
    event.preventDefault();
    window.location.reload();
  }
});

// Register Service Worker in browser if supported
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.debug('Service Worker registration skipped or failed:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
