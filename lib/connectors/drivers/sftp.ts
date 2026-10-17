import { createHash } from 'node:crypto'
import type { ConnectorCredentials } from '../types'
import { configError } from '../http'
import { assertConnectorHost } from '@/lib/net/safe-url'
import { normalizePrefix, readStorage, sampleStorage, scanStorage, testStorage, type StorageClient, type StorageObject } from '../storage/files'

/**
 * SFTP servers (partner file drops, HRIS exports), read-only. Signs in with a
 * password or a private key; the server's host key can be pinned with its
 * SHA-256 fingerprint. Files under the folder become tables like cloud storage
 * (lib/connectors/storage/files.ts). From the cloud only public hosts are
 * reached; servers inside a company network go through a Nexus Agent.
 */

const MAX_DEPTH = 6
const TIMEOUT_MS = 20_000

type Ssh2 = typeof import('ssh2')
/** ssh2 is CommonJS: under ESM (the agent bundle, tests) its exports sit on `default`. */
export async function loadSsh2(): Promise<Ssh2> {
  const mod = (await import('ssh2')) as Ssh2 & { default?: Ssh2 }
  return mod.default ?? mod
}

type SftpWrapper = import('ssh2').SFTPWrapper
type SshClient = import('ssh2').Client

/** "SHA256:base64" as OpenSSH prints it (ssh-keygen -lf), compared without padding. */
export const hostKeyFingerprint = (key: Buffer) => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`

/** A private key pasted into a one-line field loses its line breaks: put them back. */
export function pemKey(raw: string | undefined): string | undefined {
  const key = raw?.trim()
  if (!key) return undefined
  if (key.includes('\n')) return `${key}\n`
  const m = /^(-----BEGIN [A-Z0-9 ]+-----)\s*([\s\S]+?)\s*(-----END [A-Z0-9 ]+-----)$/.exec(key)
  return m ? `${m[1]}\n${m[2].split(/\s+/).join('\n')}\n${m[3]}\n` : key
}

function settings(c: ConnectorCredentials) {
  const host = c.host?.trim() ?? ''
  if (!host) throw configError('Enter the SFTP server’s host name.')
  const port = Number(c.port?.trim() || 22)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw configError('The port must be a number between 1 and 65535.')
  const username = c.username?.trim() ?? ''
  if (!username) throw configError('Enter the user name.')
  if (!c.password && !c.privateKey?.trim()) throw configError('Enter a password or a private key.')
  const fingerprint = c.hostKeyFingerprint?.trim().replace(/=+$/, '') || null
  if (fingerprint && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) throw configError('The host key fingerprint looks like SHA256:… (43 characters after the colon), as ssh-keygen -lf prints it.')
  const folder = (c.folder?.trim() || '/').replace(/\/+$/, '') || '/'
  return { host, port, username, password: c.password || undefined, privateKey: pemKey(c.privateKey), passphrase: c.passphrase || undefined, fingerprint, folder, prefix: normalizePrefix(c.prefix) }
}

/** Opens a connection; the caller ends it. */
async function connect(c: ConnectorCredentials): Promise<{ sftp: SftpWrapper; end: () => void }> {
  const s = settings(c)
  const host = await assertConnectorHost(s.host)
  const { Client } = await loadSsh2()
  const conn: SshClient = new Client()
  let seenFingerprint = ''
  const sftp = await new Promise<SftpWrapper>((resolve, reject) => {
    const fail = (err: Error & { level?: string }) => {
      const msg = err.level === 'client-authentication' ? 'The SFTP server refused the user name, password or key.' : err.message.includes('Timed out') ? `${s.host} did not answer within ${TIMEOUT_MS / 1000} s.` : `SFTP: ${err.message}`
      reject(Object.assign(new Error(msg), { retryable: err.level !== 'client-authentication' && !/host key/i.test(msg) }))
    }
    conn.on('error', fail)
    conn.on('ready', () => conn.sftp((err, w) => (err ? fail(err) : resolve(w))))
    try {
      conn.connect({
        host,
        port: s.port,
        username: s.username,
        password: s.password,
        privateKey: s.privateKey,
        passphrase: s.passphrase,
        readyTimeout: TIMEOUT_MS,
        hostVerifier: (key: Buffer) => {
          seenFingerprint = hostKeyFingerprint(key)
          return !s.fingerprint || seenFingerprint === s.fingerprint
        },
      })
    } catch (err) {
      reject(configError(`SFTP: ${err instanceof Error ? err.message : String(err)}`))
    }
  }).catch((err: Error) => {
    if (s.fingerprint && seenFingerprint && seenFingerprint !== s.fingerprint) throw configError(`The server’s host key (${seenFingerprint}) does not match the fingerprint you entered. Check with the server’s owner before changing it.`)
    throw err
  })
  return { sftp, end: () => conn.end() }
}

const readdir = (sftp: SftpWrapper, path: string) =>
  new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => sftp.readdir(path, (err, list) => (err ? reject(configError(`SFTP: cannot list ${path} (${err.message}).`)) : resolve(list))))

function readFile(sftp: SftpWrapper, path: string, range?: [number, number]) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = sftp.createReadStream(path, range ? { start: range[0], end: range[1] } : {})
    stream.on('data', (d: Buffer) => chunks.push(d))
    stream.on('error', (err: Error) => reject(Object.assign(new Error(`SFTP: cannot read ${path} (${err.message}).`), { retryable: true })))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/** A storage client that keeps one connection open while it is used (closed 5 s after the last call). */
export function sftpClient(c: ConnectorCredentials): StorageClient {
  const s = settings(c)
  const label = `SFTP server ${s.host}`
  const abs = (key: string) => `${s.folder === '/' ? '' : s.folder}/${key}`
  let session: Promise<{ sftp: SftpWrapper; end: () => void }> | null = null
  let idle: ReturnType<typeof setTimeout> | undefined
  const withSftp = async <T,>(fn: (sftp: SftpWrapper) => Promise<T>): Promise<T> => {
    clearTimeout(idle)
    session ??= connect(c)
    const current = session
    try {
      return await fn((await current).sftp)
    } catch (err) {
      // A broken connection is not reused.
      if (session === current) session = null
      current.then((x) => x.end()).catch(() => undefined)
      throw err
    } finally {
      idle = setTimeout(() => {
        const open = session
        session = null
        open?.then((x) => x.end()).catch(() => undefined)
      }, 5000)
      idle.unref?.()
    }
  }
  return {
    label,
    list: (prefix, max) =>
      withSftp(async (sftp) => {
        const out: StorageObject[] = []
        const walk = async (dir: string, rel: string, depth: number) => {
          if (out.length >= max || depth > MAX_DEPTH) return
          for (const e of await readdir(sftp, dir)) {
            if (e.filename === '.' || e.filename === '..') continue
            const key = `${rel}${e.filename}`
            const isDir = (e.attrs.mode & 0o170000) === 0o040000
            if (isDir) await walk(`${dir === '/' ? '' : dir}/${e.filename}`, `${key}/`, depth + 1)
            else if ((e.attrs.mode & 0o170000) === 0o100000) out.push({ key, size: e.attrs.size, modified: e.attrs.mtime ? new Date(e.attrs.mtime * 1000).toISOString() : null })
          }
        }
        await walk(s.folder, '', 0)
        return out.filter((o) => o.key.startsWith(prefix)).slice(0, max)
      }),
    get: (key, range) => withSftp((sftp) => readFile(sftp, abs(key), range)),
  }
}

export const testSftpConnection = (c: ConnectorCredentials) => testStorage(sftpClient(c), settings(c).prefix)
export const scanSftpSchema = (c: ConnectorCredentials) => scanStorage(sftpClient(c), settings(c).prefix, 'sftp-list')
export const sampleSftpTable = (c: ConnectorCredentials, table: string, limit = 25) => sampleStorage(sftpClient(c), settings(c).prefix, table, limit)
export const readSftpRows = (c: ConnectorCredentials, table: string, maxRows: number) => readStorage(sftpClient(c), settings(c).prefix, table, maxRows)
