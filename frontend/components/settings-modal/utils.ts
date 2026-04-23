export function fmtErr(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (/did not match the expected pattern/i.test(message)) {
    return '浏览器拦截了表单校验（pattern）。请禁用扩展或使用无痕窗口重试。'
  }
  return message || fallback
}
