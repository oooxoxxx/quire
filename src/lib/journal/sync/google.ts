import type { SyncDriver } from "./engine.ts";
import type { CloudFile } from "./engine.ts";
import { SyncError } from "./errors.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

const TOKEN_KEY = "quire-google-token";
const GIS_SRC = "https://accounts.google.com/gsi/client";

interface TokenBundle {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: unknown) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new SyncError("GOOGLE", "NO_WINDOW"));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
      const script = existing ?? document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new SyncError("GOOGLE", "GIS_LOAD_FAILED"));
      };
      if (!existing) document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export function readGoogleToken(): TokenBundle | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TokenBundle;
    if (!parsed.accessToken || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearGoogleToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function requestGoogleToken(clientId: string, prompt: "" | "consent"): Promise<TokenBundle> {
  await loadGis();
  const google = window.google;
  if (!google) throw new SyncError("GOOGLE", "GIS_UNAVAILABLE");
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (!response.access_token || response.error) {
          reject(new SyncError("AUTH", response.error || "NO_TOKEN"));
          return;
        }
        const bundle = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000,
        };
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify(bundle));
        resolve(bundle);
      },
      error_callback: () => reject(new SyncError("AUTH")),
    });
    client.requestAccessToken({ prompt });
  });
}

async function gfetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new SyncError("NETWORK", error instanceof Error ? error.message : "NETWORK");
  }
  if (response.status === 401) {
    clearGoogleToken();
    throw new SyncError("AUTH");
  }
  return response;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    return json.error?.message || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

async function listFiles(token: string, query: string, space?: "appDataFolder"): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", query);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("fields", "nextPageToken,files(id,name,modifiedTime)");
    if (space) url.searchParams.set("spaces", space);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await gfetch(url.toString(), token);
    if (!response.ok) throw new SyncError("GOOGLE", await readError(response));
    const json = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(json.files ?? []));
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

export async function downloadDriveFile(token: string, fileId: string): Promise<Uint8Array> {
  const response = await gfetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, token);
  if (!response.ok) throw new SyncError("GOOGLE", await readError(response));
  return new Uint8Array(await response.arrayBuffer());
}

async function uploadBytes(options: {
  token: string;
  name: string;
  data: Uint8Array;
  mime: string;
  existingId?: string;
  parents?: string[];
}): Promise<string> {
  const metadata: Record<string, unknown> = { name: options.name };
  if (!options.existingId && options.parents) metadata.parents = options.parents;
  const endpoint = options.existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${options.existingId}?uploadType=resumable`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  const init = await gfetch(endpoint, options.token, {
    method: options.existingId ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": options.mime,
      "X-Upload-Content-Length": String(options.data.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) throw new SyncError("GOOGLE", await readError(init));
  const location = init.headers.get("Location");
  if (location) {
    const copy = new Uint8Array(options.data.byteLength);
    copy.set(options.data);
    const put = await gfetch(location, options.token, {
      method: "PUT",
      headers: { "Content-Type": options.mime },
      body: copy,
    });
    if (!put.ok) throw new SyncError("GOOGLE", await readError(put));
    const created = (await put.json()) as { id?: string };
    return created.id || options.existingId || "";
  }
  if (options.data.byteLength > 4_500_000) {
    throw new SyncError("GOOGLE", "LARGE_UPLOAD_UNSUPPORTED");
  }
  return multipartUpload(options, metadata);
}

async function multipartUpload(
  options: { token: string; data: Uint8Array; mime: string; existingId?: string },
  metadata: Record<string, unknown>,
): Promise<string> {
  const boundary = `quire_${crypto.randomUUID()}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${options.mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const headBytes = new TextEncoder().encode(head);
  const tailBytes = new TextEncoder().encode(tail);
  const body = new Uint8Array(headBytes.length + options.data.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(options.data, headBytes.length);
  body.set(tailBytes, headBytes.length + options.data.length);
  const endpoint = options.existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${options.existingId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const response = await gfetch(endpoint, options.token, {
    method: options.existingId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) throw new SyncError("GOOGLE", await readError(response));
  const created = (await response.json()) as { id?: string };
  if (!created.id && !options.existingId) throw new SyncError("GOOGLE", "NO_FILE_ID");
  return created.id || options.existingId || "";
}

export function createGoogleDriver(token: string): SyncDriver {
  const cache = new Map<string, string>();
  let listed = false;
  async function ensureListed() {
    if (listed) return;
    const files = await listFiles(token, "trashed = false", "appDataFolder");
    files.forEach((file) => cache.set(file.name, file.id));
    listed = true;
  }
  return {
    async readManifest() {
      await ensureListed();
      const id = cache.get("quire-manifest.json");
      if (!id) return null;
      const bytes = await downloadDriveFile(token, id);
      return JSON.parse(new TextDecoder().decode(bytes)) as CloudFile;
    },
    async writeManifest(file) {
      await ensureListed();
      const bytes = new TextEncoder().encode(JSON.stringify(file));
      const id = await uploadBytes({
        token,
        name: "quire-manifest.json",
        data: bytes,
        mime: "application/json",
        existingId: cache.get("quire-manifest.json"),
        parents: ["appDataFolder"],
      });
      cache.set("quire-manifest.json", id);
    },
    async readObject(name) {
      await ensureListed();
      const id = cache.get(name);
      if (!id) return null;
      return downloadDriveFile(token, id);
    },
    async writeObject(name, data) {
      await ensureListed();
      const id = await uploadBytes({
        token,
        name,
        data,
        mime: "application/octet-stream",
        existingId: cache.get(name),
        parents: ["appDataFolder"],
      });
      cache.set(name, id);
    },
  };
}

export async function ensureBackupFolder(token: string, existingId: string | null): Promise<string> {
  if (existingId) {
    const response = await gfetch(
      `https://www.googleapis.com/drive/v3/files/${existingId}?fields=id,trashed`,
      token,
    );
    if (response.ok) {
      const json = (await response.json()) as { id: string; trashed?: boolean };
      if (!json.trashed) return json.id;
    }
  }
  const found = await listFiles(
    token,
    "name = 'Quire Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );
  if (found[0]) return found[0].id;
  const response = await gfetch("https://www.googleapis.com/drive/v3/files", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Quire Backups", mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!response.ok) throw new SyncError("GOOGLE", await readError(response));
  const created = (await response.json()) as { id: string };
  return created.id;
}

export async function uploadVisibleBackup(
  token: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  await uploadBytes({ token, name, data: bytes, mime: "application/zip", parents: [folderId] });
}

export async function listVisibleBackups(token: string, folderId: string): Promise<DriveFile[]> {
  const files = await listFiles(
    token,
    `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and name contains 'quire-backup'`,
  );
  return files.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
}
