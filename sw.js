const CACHE_NAME = "share-with-jt-v4";
const DB_NAME = "share-with-jt-files";
const DB_VERSION = 1;
const FILE_STORE = "files";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./jobtread.js",
  "./storage.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./share-target/",
];

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

async function storeSharedFiles(files) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(FILE_STORE, "readwrite");
    const store = transaction.objectStore(FILE_STORE);

    for (const file of files) {
      store.put({
        id: crypto.randomUUID(),
        blob: file,
        name: file.name || `shared-file-${Date.now()}.bin`,
        type: file.type || "",
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        addedAt: Date.now(),
      });
    }

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(APP_ASSETS.map((asset) => new URL(asset, self.registration.scope).href)),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShareTarget =
    event.request.method === "POST" &&
    (url.pathname.endsWith("/share-target/") || url.pathname.endsWith("/share-target"));

  if (isShareTarget) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          let files = formData
            .getAll("files")
            .filter((value) => value instanceof File && value.size > 0);

          if (!files.length) {
            files = Array.from(formData.values()).filter(
              (value) => value instanceof File && value.size > 0,
            );
          }
          if (!files.length) throw new Error("Android did not send any files to the app.");
          await storeSharedFiles(files);
          return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
        } catch (error) {
          return Response.redirect(
            new URL(`./?shareError=${encodeURIComponent(error.message)}`, self.registration.scope).href,
            303,
          );
        }
      })(),
    );
    return;
  }

  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(new URL("./index.html", self.registration.scope).href)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
