/**
 * Whether a battle screen is showing its result card right now. The run's top
 * bar reads it to keep the lives from before a rival battle until the result
 * is revealed.
 */
import { createStore } from '../app-state.js';

export const resultShown = createStore<boolean>(false);
