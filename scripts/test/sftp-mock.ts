import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/**
 * A local SFTP server with files in memory (connector harness and integration
 * tests), on 127.0.0.1. It signs in one user with a password, lists folders and
 * serves file bytes (ranged reads included). Its host key fingerprint is
 * returned so tests can pin it.
 */

export const SFTP_USER = { username: 'hr-drop', password: 'drop-pass' }

const FILES: Record<string, string> = {
  '/exports/hr/employees.csv': 'employee_code,full_name,salary\nE1,Ana,1000\nE2,Budi,2000\n',
  '/exports/hr/daily/2026-10-01.csv': 'employee_code,hours\nE1,8\n',
  '/exports/hr/daily/2026-10-02.csv': 'employee_code,hours\nE1,7\nE2,8\n',
  '/exports/hr/notes.txt': 'not a table',
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function startSftpMock() {
  const { loadSsh2, hostKeyFingerprint } = await import('@/lib/connectors/drivers/sftp')
  const { Server, utils } = await loadSsh2()
  const { OPEN_MODE, STATUS_CODE } = utils.sftp
  const hostKey = utils.generateKeyPairSync('ed25519')
  const dirs = new Set<string>(['/'])
  for (const f of Object.keys(FILES)) {
    const parts = f.split('/').slice(1, -1)
    for (let i = 1; i <= parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`)
  }
  const attrs = (size: number, dir: boolean) => ({ mode: dir ? 0o040755 : 0o100644, uid: 0, gid: 0, size, atime: 1790000000, mtime: 1790000000 })

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && same(ctx.username, SFTP_USER.username) && same(ctx.password, SFTP_USER.password)) return ctx.accept()
      ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp()
          const handles = new Map<number, { path: string; dir: boolean; listed?: boolean }>()
          let next = 0
          const handle = (h: Buffer) => handles.get(h.readUInt32BE(0))
          const newHandle = (entry: { path: string; dir: boolean }) => {
            const id = next++
            handles.set(id, entry)
            const b = Buffer.alloc(4)
            b.writeUInt32BE(id, 0)
            return b
          }
          sftp.on('REALPATH', (reqid, path) => sftp.name(reqid, [{ filename: path === '.' ? '/' : path, longname: path, attrs: attrs(0, true) }]))
          sftp.on('STAT', (reqid, path) => (dirs.has(path) ? sftp.attrs(reqid, attrs(0, true)) : FILES[path] !== undefined ? sftp.attrs(reqid, attrs(FILES[path].length, false)) : sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)))
          sftp.on('LSTAT', (reqid, path) => (dirs.has(path) ? sftp.attrs(reqid, attrs(0, true)) : FILES[path] !== undefined ? sftp.attrs(reqid, attrs(FILES[path].length, false)) : sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)))
          sftp.on('OPENDIR', (reqid, path) => (dirs.has(path) ? sftp.handle(reqid, newHandle({ path, dir: true })) : sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)))
          sftp.on('READDIR', (reqid, h) => {
            const entry = handle(h)
            if (!entry?.dir) return sftp.status(reqid, STATUS_CODE.FAILURE)
            if (entry.listed) return sftp.status(reqid, STATUS_CODE.EOF)
            entry.listed = true
            const prefix = entry.path === '/' ? '/' : `${entry.path}/`
            const names = new Map<string, { dir: boolean; size: number }>()
            for (const d of dirs) if (d !== entry.path && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) names.set(d.slice(prefix.length), { dir: true, size: 0 })
            for (const [f, content] of Object.entries(FILES)) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) names.set(f.slice(prefix.length), { dir: false, size: content.length })
            sftp.name(reqid, [...names].map(([filename, x]) => ({ filename, longname: filename, attrs: attrs(x.size, x.dir) })))
          })
          sftp.on('OPEN', (reqid, path, flags) => {
            if (flags & OPEN_MODE.WRITE) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
            if (FILES[path] === undefined) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)
            sftp.handle(reqid, newHandle({ path, dir: false }))
          })
          sftp.on('FSTAT', (reqid, h) => {
            const entry = handle(h)
            return entry ? sftp.attrs(reqid, attrs(entry.dir ? 0 : FILES[entry.path].length, entry.dir)) : sftp.status(reqid, STATUS_CODE.FAILURE)
          })
          sftp.on('READ', (reqid, h, offset, length) => {
            const entry = handle(h)
            if (!entry || entry.dir) return sftp.status(reqid, STATUS_CODE.FAILURE)
            const bytes = Buffer.from(FILES[entry.path])
            if (offset >= bytes.length) return sftp.status(reqid, STATUS_CODE.EOF)
            sftp.data(reqid, bytes.subarray(offset, Math.min(bytes.length, offset + length)))
          })
          sftp.on('CLOSE', (reqid, h) => {
            handles.delete(h.readUInt32BE(0))
            sftp.status(reqid, STATUS_CODE.OK)
          })
        })
      })
    })
    client.on('error', () => undefined)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const publicKey = utils.parseKey(hostKey.public)
  if (publicKey instanceof Error) throw publicKey
  const fingerprint = hostKeyFingerprint((Array.isArray(publicKey) ? publicKey[0] : publicKey).getPublicSSH())
  return {
    port,
    fingerprint,
    credentials: { host: '127.0.0.1', port: String(port), ...SFTP_USER, folder: '/exports/hr', hostKeyFingerprint: fingerprint },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}
