/**
 * The raw parsed content files from `content/`. Pass these to the matching
 * loader in `@game/core`. They are `unknown` on purpose, so nothing uses them
 * without validation.
 */
import resourcesJson from '../../../content/resources.json';

export const rawResources: unknown = resourcesJson;
