import type { ConnectorCredentials } from '../types'
import { configError, request } from '../http'
import { googleAccessToken, parseServiceAccount } from '@/lib/net/cloud-auth'
import { normalizePrefix, readStorage, sampleStorage, scanStorage, testStorage, type StorageClient, type StorageObject } from '../storage/files'

/**
 * Google Drive, read-only, through a service account a folder (or shared
 * drive) is shared with. Files under the folder become tables like cloud
 * storage (lib/connectors/storage/files.ts); Google Sheets files are read as
 * CSV (their first tab). Paths are folder names joined with "/".
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const FOLDER = 'application/vnd.google-apps.folder'
const SHEET = 'application/vnd.google-apps.spreadsheet'
const MAX_DEPTH = 6

/** The folder ID from an ID or a pasted drive.google.com/drive/folders/<ID> URL. */
export function folderIdOf(raw: string | undefined) {
  const v = (raw ?? '').trim()
  const id = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(v)?.[1] ?? v
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw configError('Enter the folder URL or ID (drive.google.com/drive/folders/<ID>) shared with the service account.')
  return id
}

function settings(c: ConnectorCredentials) {
  const api = (c.apiEndpoint?.trim() || 'https://www.googleapis.com').replace(/\/+$/, '')
  return { api, folder: folderIdOf(c.folder), sa: parseServiceAccount(c.serviceAccountJson), prefix: normalizePrefix(c.path) }
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
}

export function googleDriveClient(c: ConnectorCredentials): StorageClient {
  const s = settings(c)
  const label = 'Google Drive folder'
  const ids = new Map<string, { id: string; sheet: boolean }>()
  const send = async (url: string, extra: Record<string, string> = {}) => {
    const res = await request(label, url, { headers: { ...extra, authorization: `Bearer ${await googleAccessToken(s.sa, SCOPE)}` }, timeoutMs: 120_000 })
    if (res.ok || res.status === 206) return res
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    const msg = body.error?.message ?? `HTTP ${res.status}`
    if (res.status === 404) throw configError(`${label}: not found. Share the folder with ${s.sa.client_email} (Viewer).`)
    if (res.status === 400 || res.status === 401 || res.status === 403) throw configError(`${label}: ${msg}`)
    throw Object.assign(new Error(`${label}: ${msg}`), { retryable: true })
  }
  const children = async (folderId: string) => {
    const out: DriveFile[] = []
    let token = ''
    do {
      const q = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(token ? { pageToken: token } : {}),
      })
      const page = (await (await send(`${s.api}/drive/v3/files?${q.toString()}`)).json()) as { files?: DriveFile[]; nextPageToken?: string }
      out.push(...(page.files ?? []))
      token = page.nextPageToken ?? ''
    } while (token)
    return out
  }
  return {
    label,
    async list(prefix, max) {
      const out: StorageObject[] = []
      const walk = async (folderId: string, path: string, depth: number) => {
        if (out.length >= max || depth > MAX_DEPTH) return
        for (const f of await children(folderId)) {
          const key = `${path}${f.name}`
          if (f.mimeType === FOLDER) await walk(f.id, `${key}/`, depth + 1)
          else if (f.mimeType === SHEET) {
            ids.set(`${key}.csv`, { id: f.id, sheet: true })
            out.push({ key: `${key}.csv`, size: 0, modified: f.modifiedTime ?? null })
          } else {
            ids.set(key, { id: f.id, sheet: false })
            out.push({ key, size: Number(f.size ?? 0), modified: f.modifiedTime ?? null })
          }
        }
      }
      await walk(s.folder, '', 0)
      return out.filter((o) => o.key.startsWith(prefix)).slice(0, max)
    },
    async get(key, range) {
      if (!ids.has(key)) await this.list('', 5000)
      const file = ids.get(key)
      if (!file) throw configError(`${key} is not in the Google Drive folder.`)
      if (file.sheet) return Buffer.from(await (await send(`${s.api}/drive/v3/files/${file.id}/export?mimeType=text%2Fcsv`)).arrayBuffer())
      const res = await send(`${s.api}/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, range ? { range: `bytes=${range[0]}-${range[1]}` } : {})
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

export const testGoogleDriveConnection = (c: ConnectorCredentials) => testStorage(googleDriveClient(c), settings(c).prefix)
export const scanGoogleDriveSchema = (c: ConnectorCredentials) => scanStorage(googleDriveClient(c), settings(c).prefix, 'google-drive-list')
export const sampleGoogleDriveTable = (c: ConnectorCredentials, table: string, limit = 25) => sampleStorage(googleDriveClient(c), settings(c).prefix, table, limit)
export const readGoogleDriveRows = (c: ConnectorCredentials, table: string, maxRows: number) => readStorage(googleDriveClient(c), settings(c).prefix, table, maxRows)
