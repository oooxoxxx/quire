import type { SealedBox } from "./types.ts";

export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomId(): string {
  return crypto.randomUUID();
}

function asBuffer(data: Uint8Array): ArrayBuffer {
  return toArrayBuffer(data);
}

async function importPass(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

export async function hashSecret(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const base = await importPass(secret);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBuffer(salt), iterations, hash: "SHA-256" },
    base,
    256,
  );
  return bytesToB64(new Uint8Array(bits));
}

export async function deriveAesKey(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await importPass(secret);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBuffer(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let out = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) out |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return out === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<SealedBox> {
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, plain);
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(buf)) };
}

export async function decryptJson<T>(key: CryptoKey, box: SealedBox): Promise<T> {
  const iv = b64ToBytes(box.iv);
  const data = b64ToBytes(box.data);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(data),
  );
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

export async function encryptBytes(
  key: CryptoKey,
  data: Uint8Array,
): Promise<{ iv: string; bytes: Uint8Array }> {
  const iv = randomBytes(12);
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, asBuffer(data));
  return { iv: bytesToB64(iv), bytes: new Uint8Array(buf) };
}

export async function decryptBytes(key: CryptoKey, iv: string, data: Uint8Array): Promise<Uint8Array> {
  const ivBytes = b64ToBytes(iv);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(ivBytes) },
    key,
    asBuffer(data),
  );
  return new Uint8Array(buf);
}

const VERIFIER_TEXT = "quire-ok";

export async function makeVerifier(key: CryptoKey): Promise<SealedBox> {
  return encryptJson(key, VERIFIER_TEXT);
}

export async function checkVerifier(key: CryptoKey, box: SealedBox): Promise<boolean> {
  try {
    return (await decryptJson<string>(key, box)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}
