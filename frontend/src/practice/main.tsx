import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PracticeApp from './PracticeApp';
import './practice.css';

const root = document.getElementById('practice-root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PracticeApp />
    </StrictMode>,
  );
}
