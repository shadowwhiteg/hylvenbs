import { EventEmitter } from "node:events";

/**
 * Barramento in-process (T3/D-SSE do design 004): o handler de SSE assina por runId
 * e é notificado sempre que novos spans/logs foram gravados ou o status mudou. Sem
 * payload no evento — o assinante relê o banco a partir do cursor, então perder um
 * evento (ex.: dois flushes seguidos) não perde dado, só funde duas atualizações.
 */
export const runBus = new EventEmitter();
runBus.setMaxListeners(0);

export function emitRunEvent(runId: string): void {
  runBus.emit(`run:${runId}`, undefined);
}

export function onRunEvent(runId: string, listener: () => void): () => void {
  runBus.on(`run:${runId}`, listener);
  return () => runBus.off(`run:${runId}`, listener);
}
