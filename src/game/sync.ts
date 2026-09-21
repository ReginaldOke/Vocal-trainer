/**
 * Progress sync without accounts. A random code made on this device names the record; anyone
 * with the code can load it on another device. The backend is a Supabase project reached over
 * plain fetch (see supabase/setup.sql): two functions, so the public key can only read or write
 * one record at a time and never list them.
 */
import { adoptProgress, type Progress } from "./progress";
import { SYNC_CONFIG } from "../sync.config";

const CODE_KEY = "vocal-coach.sync-code";
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SYNC_CONFIG.url;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SYNC_CONFIG.anonKey;

export const syncEnabled = () => Boolean(url && key && !url.includes("YOUR-PROJECT"));

export type SyncState = { status: "off" | "idle" | "saving" | "saved" | "error"; at: number; message?: string };
let state: SyncState = { status: syncEnabled() ? "idle" : "off", at: 0 };
const listeners = new Set<(s: SyncState) => void>();
const set = (s: SyncState) => { state = s; listeners.forEach((fn) => fn(s)); };
export const getSyncState = () => state;
export function onSyncState(fn: (s: SyncState) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Easy to read out and type: no ambiguous letters, grouped in threes. */
export function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");

export function getCode(): string {
  let c = localStorage.getItem(CODE_KEY);
  if (!c) { c = makeCode(); localStorage.setItem(CODE_KEY, c); }
  return c;
}
export function setCode(c: string) { localStorage.setItem(CODE_KEY, normaliseCode(c)); }

async function rpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} failed (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let queued: Progress | null = null;

/** Save soon; repeated calls collapse into one request. */
export function pushProgress(p: Progress) {
  if (!syncEnabled()) return;
  queued = p;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 1500);
}

async function flush() {
  timer = null;
  const p = queued;
  queued = null;
  if (!p) return;
  set({ status: "saving", at: Date.now() });
  try {
    await rpc("put_progress", { p_code: getCode(), p_data: p, p_updated_at: p.updatedAt });
    set({ status: "saved", at: Date.now() });
  } catch (e) {
    set({ status: "error", at: Date.now(), message: e instanceof Error ? e.message : "Could not save" });
  }
}

/** Fetch the record for a code; null when there is none. */
export async function pullProgress(code = getCode()): Promise<Progress | null> {
  if (!syncEnabled()) return null;
  const row = await rpc("get_progress", { p_code: normaliseCode(code) }) as { data: Progress; updated_at: number } | null;
  return row && row.data ? { ...row.data, updatedAt: row.updated_at ?? row.data.updatedAt ?? 0 } : null;
}

/** On load: take the remote record if it is newer than what this device has. */
export async function reconcile(local: Progress): Promise<Progress | null> {
  try {
    const remote = await pullProgress();
    if (remote && remote.updatedAt > (local.updatedAt ?? 0)) { adoptProgress(remote); set({ status: "saved", at: Date.now() }); return remote; }
    if (!remote && local.plays > 0) pushProgress(local);
    return null;
  } catch (e) {
    set({ status: "error", at: Date.now(), message: e instanceof Error ? e.message : "Could not reach the server" });
    return null;
  }
}

/** Switch this device to another device's code and load its record. */
export async function useCode(code: string): Promise<Progress | null> {
  const remote = await pullProgress(code);
  if (!remote) return null;
  setCode(code);
  adoptProgress(remote);
  set({ status: "saved", at: Date.now() });
  return remote;
}
