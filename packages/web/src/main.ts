import { add, loadResourcesOrThrow } from '@game/core';
import { rawResources } from '@game/content';

const resources = loadResourcesOrThrow(rawResources);

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  const names = resources
    .list()
    .map((r) => resources.displayName(r.id))
    .join(', ');
  const content = document.createElement('p');
  content.textContent = `Placeholder page. core says 2 + 3 = ${String(add(2, 3))}. Resources: ${names}`;

  const footer = document.createElement('footer');
  footer.id = 'build-id';
  footer.style.cssText = 'margin-top:2rem;font-size:0.75rem;opacity:0.6;';
  footer.textContent = `Build ${__BUILD_COMMIT__} · ${__BUILD_DATE__}`;

  app.append(content, footer);
}
