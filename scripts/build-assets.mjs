import { cp, mkdir, rm, stat } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

try {
  await stat('public');
  await cp('public', 'dist', { recursive: true, force: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  console.warn('No public/ directory found; deploying an empty asset directory.');
}
