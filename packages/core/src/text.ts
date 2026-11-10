/**
 * Text templates. Presentation text refers to a resource as `{res_x}` instead
 * of repeating its name, so a rename in the resource file reaches every
 * description (TA-27a, TA-27b).
 */

import type { ResourceConfig } from './resources.js';

const PLACEHOLDER = /\{(res_[a-z0-9_]+)\}/g;

/** Resource IDs mentioned as `{res_x}` in a template, in order, with repeats. */
export function placeholderIds(template: string): string[] {
  return Array.from(template.matchAll(PLACEHOLDER), (m) => m[1] ?? '');
}

/**
 * Replace each `{res_x}` with that resource's display name. Throws if a
 * placeholder names an unknown resource. Other text is left as it is.
 */
export function formatText(
  template: string,
  resources: ResourceConfig,
): string {
  return template.replace(PLACEHOLDER, (_whole, id: string) =>
    resources.displayName(id),
  );
}
