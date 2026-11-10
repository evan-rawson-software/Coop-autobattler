import { add } from '@game/core';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  const content = document.createElement('p');
  content.textContent = `Placeholder page. core says 2 + 3 = ${String(add(2, 3))}`;

  const footer = document.createElement('footer');
  footer.id = 'build-id';
  footer.style.cssText = 'margin-top:2rem;font-size:0.75rem;opacity:0.6;';
  footer.textContent = `Build ${__BUILD_COMMIT__} · ${__BUILD_DATE__}`;

  app.append(content, footer);
}
