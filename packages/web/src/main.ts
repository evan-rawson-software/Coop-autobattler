import { add } from '@game/core';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.textContent = `Placeholder page. core says 2 + 3 = ${String(add(2, 3))}`;
}
