import { render } from 'preact';
import './styles.css';
import './skin.css';
import { App } from './shell/App.js';
import { installSkin } from './sprites/skin.js';

const root = document.querySelector<HTMLElement>('#app');
if (root) render(<App />, root);
// The sprite sheets and the pixel skin load after the first paint.
setTimeout(() => {
  void installSkin();
}, 0);
