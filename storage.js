const DB_NAME = "share-with-jt-files";
const DB_VERSION = 1;
const FILE_STORE = "files";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILE_STORE)) {
        database.createObjectStore(FILE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, action) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(FILE_STORE, mode);
        const store = transaction.objectStore(FILE_STORE);
        let result;

        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error("File storage transaction was aborted."));
        };

        result = action(store);
      }),
  );
}

export function createFileRecord(file) {
  const fallbackName = `file-${new Date().toISOString().replaceAll(":", "-")}.bin`;
  return {
    id: crypto.randomUUID(),
    blob: file,
    name: file.name || fallbackName,
    type: file.type || "",
    size: file.size,
    lastModified: file.lastModified || Date.now(),
    addedAt: Date.now(),
  };
}

export function addFiles(files) {
  const accepted = Array.from(files).filter((file) => file instanceof Blob && file.size > 0);

  return runTransaction("readwrite", (store) => {
    for (const file of accepted) {
      store.put(createFileRecord(file));
    }
    return accepted.length;
  });
}

export function listFiles() {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(FILE_STORE, "readonly");
        const request = transaction.objectStore(FILE_STORE).getAll();

        request.onsuccess = () => {
          database.close();
          resolve(request.result.sort((a, b) => a.addedAt - b.addedAt));
        };
        request.onerror = () => {
          database.close();
          reject(request.error);
        };
      }),
  );
}

export function removeFile(id) {
  return runTransaction("readwrite", (store) => store.delete(id));
}

export function clearFiles() {
  return runTransaction("readwrite", (store) => store.clear());
}
