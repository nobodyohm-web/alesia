import { join } from 'node:path';

const ALESIA_DIR = '.alesia';

export function getAlesiaDir(): string {
  return ALESIA_DIR;
}

export function alesiaPath(...segments: string[]): string {
  return join(getAlesiaDir(), ...segments);
}
