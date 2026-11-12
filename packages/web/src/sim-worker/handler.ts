/**
 * What the worker does with one request. A plain function so the same code
 * runs in the worker, in the synchronous fallback and in tests.
 */

import { simulateRecord } from '../battle/playback.js';
import { battleConfig } from '../battle/setup.js';
import { content } from '../content.js';
import type { SimRequest, SimResponse } from './protocol.js';

export function handleRequest(req: SimRequest): SimResponse {
  try {
    return {
      id: req.id,
      kind: 'result',
      result: simulateRecord(req.desc, content, battleConfig),
    };
  } catch (e) {
    return {
      id: req.id,
      kind: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
