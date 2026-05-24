import { createHmac } from 'node:crypto';

export function keyedHash(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[secret]')
    .replace(/\b(?:token|secret|key|auth)=\S+/gi, '$1=[secret]')
    .slice(0, 240);
}
