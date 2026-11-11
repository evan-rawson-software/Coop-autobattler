import { render } from 'preact';
import './styles.css';
import { App } from './shell/App.js';

const root = document.querySelector<HTMLElement>('#app');
if (root) render(<App />, root);
