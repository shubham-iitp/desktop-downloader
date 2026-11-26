/* Minimal logger that redacts secrets (RPC secret, cookies, Authorization headers). */

const REDACT: [RegExp, string][] = [
  [/(--rpc-secret=)\S+/g, '$1***'],
  [/(token:)[0-9a-f]{16,}/gi, '$1***'],
  [/((?:cookie|authorization|proxy-authorization)\s*:\s*)[^\n"]+/gi, '$1***']
];

export function redact(text: string): string {
  return REDACT.reduce((t, [re, rep]) => t.replace(re, rep), text);
}

const fmt = (args: unknown[]) =>
  redact(args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

export const log = {
  info: (...args: unknown[]) => console.log('[main]', fmt(args)),
  warn: (...args: unknown[]) => console.warn('[main]', fmt(args)),
  error: (...args: unknown[]) => console.error('[main]', fmt(args))
};
