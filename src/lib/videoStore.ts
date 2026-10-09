// Recordings live in IndexedDB, keyed by result id. History itself only keeps text.

const DB_NAME = 'hirecrack-videos';
const STORE = 'videos';
const KEEP = 20;

interface Row {
  id: string;
  blob: Blob;
  savedAt: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function saveVideo(id: string, blob: Blob): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ id, blob, savedAt: Date.now() } satisfies Row);
    const all = store.getAll();
    all.onsuccess = () => {
      const rows = (all.result as Row[]).sort((a, b) => b.savedAt - a.savedAt);
      rows.slice(KEEP).forEach((r) => store.delete(r.id));
    };
    await done(tx);
  } catch {
    // Storage is full or blocked; the recording just won't be kept.
  } finally {
    db.close();
  }
}

export async function loadVideo(id: string): Promise<Blob | null> {
  const db = await open();
  if (!db) return null;
  try {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    return await new Promise<Blob | null>((resolve) => {
      req.onsuccess = () => resolve((req.result as Row | undefined)?.blob ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function clearVideos(): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  } catch {
    // Nothing to clear.
  } finally {
    db.close();
  }
}
