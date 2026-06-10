/**
 * Drizzle 链式查询 mock
 *
 * Drizzle 查询是链式 API + thenable：
 *   db.insert(table).values({...}).returning()  → Promise<Array>
 *   db.select().from(table).where(...).limit()  → Promise<Array>
 *   db.update(table).set({...}).where(...)       → Promise<void>
 *
 * 此 mock 用 Proxy 让任何链式方法调用都可通过，
 * 最终在 await 时（.then）返回预设结果。
 */

/**
 * 创建一个链式 thenable mock
 * @param getResult 延迟求值的返回函数，确保运行时读取最新值
 */
function createChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      // await 触发 .then()，返回预设结果
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (r?: unknown) => void) =>
          Promise.resolve(getResult()).then(resolve, reject)
      }
      if (typeof prop === 'symbol') return undefined
      // 任何其他方法调用继续返回自身，支持无限链式
      return (..._args: unknown[]) => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

export interface MockDb {
  /** 注入 setDb() 用的 mock 实例 */
  db: any
  /** 设置 insert 操作的返回值 */
  setInsertResult: (result: unknown[]) => void
  /** 设置 select 操作的返回值 */
  setSelectResult: (result: unknown[]) => void
}

/**
 * 创建 mock Drizzle 实例
 *
 * 用法：
 *   const mock = createMockDb()
 *   mock.setInsertResult([{ id: 'test-id' }])
 *   setDb(mock.db)
 *   const result = await createGenerationRecord({...})
 */
export function createMockDb(): MockDb {
  let insertResult: unknown[] = [{}]
  let selectResult: unknown[] = []

  return {
    db: {
      insert: (..._args: unknown[]) => createChain(() => insertResult),
      select: (..._args: unknown[]) => createChain(() => selectResult),
      update: (..._args: unknown[]) => createChain(() => undefined),
    },
    setInsertResult: (r) => { insertResult = r },
    setSelectResult: (r) => { selectResult = r },
  }
}
