
export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: MessageRole;
  text: string;
  image?: string;
  timestamp: number;
  groundingMetadata?: GroundingMetadata;
}

export interface GroundingMetadata {
  searchChunks?: { uri: string; title: string }[];
  mapChunks?: { uri: string; title: string; source?: string }[];
}

export interface ChatSession {
  id: string;
  userId: string;
  timestamp: number;
  preview: string;
  messages: ChatMessage[];
}

export interface SavedStory {
  id: string;
  userId: string;
  title: string;
  fullText: string;
  prompt: string;
  timestamp: number;
  lastPosition?: number; 
  totalDuration?: number; 
  isGenerating?: boolean; 
  isEncodingAudio?: boolean; 
  audioData?: string; 
}

// Added DiaryEntry interface to fix export errors in other files
export interface DiaryEntry {
  id: string;
  userId: string;
  title?: string;
  content: string;
  timestamp: number;
}

export interface Settings {
  userId: string;
  name: string;
  aiGender: 'male' | 'female';
  language: string;
  personality: string;
  personalityTrait?: string;
  speakingStyle?: string;
  voiceName: string;
  useLocalMode: boolean;
  userBio: string;
  aiProvider: 'gemini';
  // Added optional Azure config fields to resolve access errors in azureService
  azureApiKey?: string;
  azureEndpoint?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
}

export enum AppMode {
  CHAT = 'chat',
  VOICE = 'voice',
  GALLERY = 'gallery',
  SETTINGS = 'settings',
  PLAYER = 'player',
  GENERATOR = 'generator',
  PERCHANCE = 'perchance'
}

export interface GeneratedImage {
  id: string;
  userId: string;
  url: string;
  prompt: string;
  timestamp: number;
}

export interface LearnedInteraction {
  id?: number;
  userId: string;
  input: string;
  response: string;
  timestamp: number;
}
