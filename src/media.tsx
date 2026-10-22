import {useEffect, useState, type ImgHTMLAttributes} from 'react';

// Local demo-only images are saved as blobs in IndexedDB, not localStorage.
// Connected mode uses public URLs returned by Firebase Storage.
const DB_NAME = 'elbem-demo-media';
const STORE = 'images';
const PREFIX = 'elbem-local-image:';
let dbPromise: Promise<IDBDatabase> | undefined;
function openMediaDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Этот браузер не поддерживает IndexedDB'));
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve,reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Нет доступа к локальному хранилищу'));
      request.onblocked = () => reject(new Error('Закройте другие вкладки сайта и повторите'));
    }).catch(error => {dbPromise = undefined; throw error;});
  }
  return dbPromise;
}

async function optimizePhoto(file: File): Promise<Blob> {
  // A photo may be much larger than its on-page frame; resizing saves device space.
  if (!('createImageBitmap' in window)) return file;
  let bitmap: ImageBitmap;
  try {bitmap = await createImageBitmap(file);} catch {return file;}
  try {
    const ratio = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    if (ratio === 1 && file.size < 750_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.86));
    return compressed && compressed.type === 'image/webp' && compressed.size < file.size ? compressed : file;
  } finally {bitmap.close();}
}

export async function saveLocalImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || file.size > 25 * 1024 * 1024) {
    throw new Error('Допустимы изображения JPEG, PNG, WebP, GIF и AVIF до 25 МБ');
  }
  const data = file.type === 'image/gif' ? file : await optimizePhoto(file);
  const key = crypto.randomUUID();
  const db = await openMediaDatabase();
  await new Promise<void>((resolve,reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(data, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить фото'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Хранилище недоступно'));
  });
  return `${PREFIX}${key}`;
}

async function readLocalImage(value: string): Promise<Blob | null> {
  const db = await openMediaDatabase();
  return new Promise((resolve,reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(value.slice(PREFIX.length));
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать фото'));
  });
}

/** Resolves a persisted local-media key into a temporary object URL. */
export function MediaImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const {src, ...rest} = props;
  const [resolved, setResolved] = useState(src?.startsWith(PREFIX) ? '' : src);
  useEffect(() => {
    if (!src?.startsWith(PREFIX)) {setResolved(src); return;}
    let active = true;
    let objectUrl: string | undefined;
    setResolved('');
    void readLocalImage(src).then(blob => {
      if (blob && active) {objectUrl = URL.createObjectURL(blob); setResolved(objectUrl);}
    }).catch(error => {if (active) console.warn('Не удалось загрузить локальное фото', error);});
    return () => {active = false; if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [src]);
  return <img {...rest} src={resolved} />;
}
