/**
 * Minimal .env file loader (no external dependency).
 * Used by scripts/ and available for tests.
 */
import { readFileSync, existsSync } from 'node:fs';

export function loadEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(path)) return result;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) result[key] = value;
  }
  return result;
}

export function processEnvWithFile(file = '.env'): Record<string, string | undefined> {
  const fileVars = loadEnvFile(file);
  return { ...fileVars, ...process.env } as Record<string, string | undefined>;
}
