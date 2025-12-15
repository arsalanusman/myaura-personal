
import { Settings, ChatSession, ChatMessage, GeneratedImage, DiaryEntry, LearnedInteraction } from '../types';

const DB_NAME = 'AuraDB';
const DB_VERSION = 2; // Upgraded version for User ID support

class AuraDB {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
          console.error("Database error:", request.error);
          reject(request.error);
      };

      request.onsuccess = () => {
          resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const txn = (event.target as IDBOpenDBRequest).transaction;
        
        // Settings Store (Key: phoneNumber)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'userId' });
        }

        // Chat History (Archives)
        if (!db.objectStoreNames.contains('chat_history')) {
          const store = db.createObjectStore('chat_history', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        } else if (txn) {
            const store = txn.objectStore('chat_history');
            if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false });
        }

        // Current Active Chat Messages
        if (!db.objectStoreNames.contains('active_chat')) {
          const store = db.createObjectStore('active_chat', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        } else if (txn) {
            const store = txn.objectStore('active_chat');
            if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false });
        }

        // Gallery Images
        if (!db.objectStoreNames.contains('gallery')) {
          const store = db.createObjectStore('gallery', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        } else if (txn) {
            const store = txn.objectStore('gallery');
            if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false });
        }

        // Diary Entries
        if (!db.objectStoreNames.contains('diary')) {
          const store = db.createObjectStore('diary', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        } else if (txn) {
            const store = txn.objectStore('diary');
            if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false });
        }

        // Learning Memory
        if (db.objectStoreNames.contains('memory')) {
           // Migration: Old memory store used 'input' as key. We need to recreate it or just delete it to reset structure
           db.deleteObjectStore('memory');
        }
        
        const memStore = db.createObjectStore('memory', { keyPath: 'id', autoIncrement: true });
        memStore.createIndex('userId', 'userId', { unique: false });
      };
    });
  }

  private async getStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.dbPromise;
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  // --- USER SPECIFIC OPERATIONS ---

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

  // --- SPECIFIC HELPERS ---

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
          // 1. Get all existing keys for this user to delete them (cleanup)
          const keyRequest = index.getAllKeys(IDBKeyRange.only(userId));
          
          keyRequest.onsuccess = () => {
              const keys = keyRequest.result;
              
              // 2. Delete old entries for this user
              if (keys.length > 0) {
                  keys.forEach(key => store.delete(key));
              }

              // 3. Add new messages
              if (messages.length === 0) {
                  resolve();
                  return;
              }
              
              let completed = 0;
              messages.forEach(msg => {
                  // Ensure message has userId
                  const msgWithId = { ...msg, userId }; 
                  const req = store.put(msgWithId);
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
