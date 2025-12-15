
export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface ChatMessage {
  id: string;
  userId: string; // Phone number
  role: MessageRole;
  text: string;
  image?: string; // Base64 or URL
  timestamp: number;
  groundingMetadata?: GroundingMetadata;
}

export interface GroundingMetadata {
  searchChunks?: { uri: string; title: string }[];
  mapChunks?: { uri: string; title: string; source: string }[];
}

export interface ChatSession {
  id: string;
  userId: string;
  timestamp: number;
  preview: string; // Short text to display in list
  messages: ChatMessage[];
}

export interface Settings {
  userId: string; // Phone number serves as ID
  name: string;
  language: string; // e.g., "Romanian", "Italian", "English"
  personality: string;
  voiceName: string;
  useLocalMode: boolean; // New setting for offline/no-AI mode
  userBio: string; // Long-term memory about the user
}

export enum AppMode {
  CHAT = 'chat',
  VOICE = 'voice',
  GALLERY = 'gallery',
  SETTINGS = 'settings',
  DIARY = 'diary'
}

export interface GeneratedImage {
  id: string;
  userId: string;
  url: string;
  prompt: string;
  timestamp: number;
}

export interface DiaryEntry {
  id: string;
  userId: string;
  content: string;
  timestamp: number;
  mood?: string;
}

export interface LearnedInteraction {
  id?: number;
  userId: string;
  input: string;
  response: string;
  timestamp: number;
}
