/// <reference lib="webworker" />
/** Entry of the simulation worker (loaded as a module worker by the client). */

import { handleRequest } from './handler.js';
import { recordTransferables, type SimRequest } from './protocol.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (ev: MessageEvent<SimRequest>): void => {
  const res = handleRequest(ev.data);
  const transfer =
    res.kind === 'result' && res.result.ok
      ? recordTransferables(res.result.record)
      : [];
  scope.postMessage(res, { transfer });
};
