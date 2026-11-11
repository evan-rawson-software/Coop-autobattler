/**
 * The pixel interface skin. Once the atlas has loaded, the interface sprites
 * that CSS needs (textures and 9-slice frames) are cut out of the sheet as
 * data URLs and set as custom properties on the root element
 * (`--sprite-ui-bg` and friends), and `data-skin="pixel"` is set. All skin
 * rules in `skin.css` hang off that attribute, so until then, and if loading
 * fails, the plain flat interface stays exactly as it was.
 */

import { loadSprites } from './atlas.js';
import { spriteUrl } from './SpriteIcon.js';

const CSS_SPRITES = [
  'ui_bg',
  'ui_panel',
  'ui_card',
  'ui_button_normal',
  'ui_button_hover',
  'ui_button_disabled',
] as const;

/** Load the sprites (once) and switch the skin on. Never throws. */
export async function installSkin(): Promise<void> {
  try {
    const set = await loadSprites();
    if (!set || !set.sheets.images['ui']) return;
    const root = document.documentElement;
    for (const name of CSS_SPRITES) {
      const url = spriteUrl(name);
      if (url)
        root.style.setProperty(
          `--sprite-${name.replace(/_/g, '-')}`,
          `url("${url}")`,
        );
    }
    root.dataset['skin'] = 'pixel';
  } catch {
    // The flat interface is the fallback.
  }
}
