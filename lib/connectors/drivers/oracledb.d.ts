declare module 'oracledb' {
  const oracledb: {
    OUT_FORMAT_OBJECT: number
    getConnection(config: Record<string, unknown>): Promise<{
      execute<T>(sql: string, binds?: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ rows?: T[] }>
      close(): Promise<void>
    }>
  }
  export default oracledb
}
