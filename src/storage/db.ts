import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredSession } from '../model';

interface SkjutDB extends DBSchema {
  sessions: {
    key: string;
    value: StoredSession;
    indexes: { byCreated: number };
  };
}

let dbPromise: Promise<IDBPDatabase<SkjutDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<SkjutDB>('skjutapp', 1, {
      upgrade(d) {
        const store = d.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('byCreated', 'createdAt');
      },
    });
    // Ask the browser not to evict our data under storage pressure.
    navigator.storage?.persist?.().catch(() => undefined);
  }
  return dbPromise;
}

export async function saveSession(s: StoredSession): Promise<void> {
  await (await db()).put('sessions', s);
}

export async function getSession(id: string): Promise<StoredSession | undefined> {
  return (await db()).get('sessions', id);
}

/** All sessions, newest first. */
export async function listSessions(): Promise<StoredSession[]> {
  const all = await (await db()).getAllFromIndex('sessions', 'byCreated');
  return all.reverse();
}

export async function deleteSession(id: string): Promise<void> {
  await (await db()).delete('sessions', id);
}

// ---- JSON export / import (images as data URLs) ----

interface ExportedSession extends Omit<StoredSession, 'image' | 'thumb'> {
  image: string;
  thumb: string;
}

interface ExportFile {
  app: 'skjutapp';
  version: 1;
  exportedAt: string;
  sessions: ExportedSession[];
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

const dataUrlToBlob = async (url: string) => (await fetch(url)).blob();

export async function exportSessions(): Promise<Blob> {
  const sessions = await listSessions();
  const out: ExportFile = {
    app: 'skjutapp',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: await Promise.all(
      sessions.map(async (s) => ({ ...s, image: await blobToDataUrl(s.image), thumb: await blobToDataUrl(s.thumb) })),
    ),
  };
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

/** Import sessions from an export file. Existing sessions with the same id are replaced. */
export async function importSessions(file: Blob): Promise<number> {
  const data = JSON.parse(await file.text()) as ExportFile;
  if (data.app !== 'skjutapp' || !Array.isArray(data.sessions)) throw new Error('Not a Skjutapp export file');
  for (const s of data.sessions) {
    if (typeof s.image !== 'string' || !s.image.startsWith('data:image/')) throw new Error('Invalid image in export');
    if (typeof s.thumb !== 'string' || !s.thumb.startsWith('data:image/')) throw new Error('Invalid thumbnail in export');
    await saveSession({ ...s, image: await dataUrlToBlob(s.image), thumb: await dataUrlToBlob(s.thumb) });
  }
  return data.sessions.length;
}
