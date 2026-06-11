/**
 * 从 catch 捕获的 unknown error 中安全提取错误消息
 *
 * 使用场景：catch (err: unknown) 时替代 catch (err: any) + err?.message
 *
 * @example
 * catch (err: unknown) {
 *   setError(getErrorMessage(err))
 * }
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error)
    return err.message
  if (typeof err === 'string')
    return err
  return String(err)
}
