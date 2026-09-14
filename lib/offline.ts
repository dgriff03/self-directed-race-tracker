import type { Race } from "../shared/race";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("milemark-offline", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("races", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveRace(race: Race, alias?: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("races", "readwrite");
      tx.objectStore("races").put(race);
      if (alias && alias !== race.id)
        tx.objectStore("races").put({
          ...race,
          id: alias,
          canonicalId: race.id,
        });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function loadRace(id: string): Promise<Race | null> {
  const db = await database();
  try {
    const cached = await new Promise<Race | undefined>((resolve, reject) => {
      const req = db.transaction("races").objectStore("races").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (cached)
      return {
        ...cached,
        id:
          (cached as Race & { canonicalId?: string }).canonicalId ?? cached.id,
      };
    const legacy = localStorage.getItem(`race:${id}`);
    if (!legacy) return null;
    const race = JSON.parse(legacy) as Race;
    await saveRace(race);
    localStorage.removeItem(`race:${id}`);
    return race;
  } finally {
    db.close();
  }
}
