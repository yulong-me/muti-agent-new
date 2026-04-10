export function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${metaStr}`);
}
