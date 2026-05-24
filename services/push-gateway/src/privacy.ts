import { createHmac } from 'node:crypto';

export function keyedHash(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[secret]')
    .slice(0, 240);
}
