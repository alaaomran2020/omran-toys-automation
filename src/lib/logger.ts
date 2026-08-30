import type { WorkflowLogger } from '../core/workflow.js';

/**
 * Minimal structured JSON console logger.
 * (Fastify keeps its own logger for HTTP-level logging.)
 *
 * RULE: never log API keys, tokens or secrets — only structured event data.
 */
export function createConsoleLogger(): WorkflowLogger {
  const emit =
    (level: 'info' | 'warn' | 'error') =>
    (message: string, meta?: Record<string, unknown>): void => {
      const line = JSON.stringify({ level, msg: message, ...(meta ?? {}) });
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    };
  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}
