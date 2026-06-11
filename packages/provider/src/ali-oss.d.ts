declare module 'ali-oss' {
  class OSS {
    constructor(options: {
      accessKeyId: string
      accessKeySecret: string
      bucket: string
      region: string
      endpoint?: string
    })
    put(key: string, data: Buffer | Blob | string, options?: { headers?: Record<string, string> }): Promise<{ url: string, name: string }>
    get(key: string): Promise<{ content: Buffer, res: any }>
    delete(key: string): Promise<any>
  }
  export default OSS
}
