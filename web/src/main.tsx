import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './components/App';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>,
  );
}
