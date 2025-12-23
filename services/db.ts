
import { Settings, ChatMessage } from '../types';

const DB_NAME = 'AuraDB';
const DB_VERSION = 3; 

class AuraDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    this.initDB();
  }

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("Database error:", request.error);
        this.dbPromise = null;
        reject(request.error);
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('chat_history')) {
          const store = db.createObjectStore('chat_history', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('active_chat')) {
          const store = db.createObjectStore('active_chat', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('gallery')) {
          const store = db.createObjectStore('gallery', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('diary')) {
          const store = db.createObjectStore('diary', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('saved_stories')) {
          const store = db.createObjectStore('saved_stories', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (db.objectStoreNames.contains('memory')) {
           db.deleteObjectStore('memory');
        }
        const memStore = db.createObjectStore('memory', { keyPath: 'id', autoIncrement: true });
        memStore.createIndex('userId', 'userId', { unique: false });
      };
    });

    return this.dbPromise;
  }

  private async getDB(): Promise<IDBDatabase> {
    try {
      const db = await this.initDB();
      // Verify connection isn't closed
      return db;
    } catch (e) {
      this.dbPromise = null;
      return await this.initDB();
    }
  }

  private async getStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.getDB();
    try {
      return db.transaction(storeName, mode).objectStore(storeName);
    } catch (e: any) {
      if (e.name === 'InvalidStateError' || e.message?.includes('closing')) {
        this.dbPromise = null;
        const newDb = await this.getDB();
        return newDb.transaction(storeName, mode).objectStore(storeName);
      }
      throw e;
    }
  }

  async getAllByUserId<T>(storeName: string, userId: string): Promise<T[]> {
    const store = await this.getStore(storeName, 'readonly');
    const index = store.index('userId');
    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(userId));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName: string, value: any): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, key: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSettings(userId: string): Promise<Settings | undefined> {
    const store = await this.getStore('settings', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(userId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.put('settings', settings);
  }

  async saveActiveChat(userId: string, messages: ChatMessage[]): Promise<void> {
    const store = await this.getStore('active_chat', 'readwrite');
    const index = store.index('userId');
    return new Promise((resolve, reject) => {
      const keyRequest = index.getAllKeys(IDBKeyRange.only(userId));
      keyRequest.onsuccess = () => {
        const keys = keyRequest.result;
        if (keys.length > 0) keys.forEach(key => store.delete(key));
        if (messages.length === 0) { resolve(); return; }
        let completed = 0;
        messages.forEach(msg => {
          const req = store.put({ ...msg, userId });
          req.onsuccess = () => {
            completed++;
            if (completed === messages.length) resolve();
          };
        });
      };
      keyRequest.onerror = () => reject(keyRequest.error);
    });
  }
}

export const db = new AuraDB();
