
import { 
  GoogleGenAI, 
  Chat, 
  Type,
  LiveServerMessage,
  Modality,
  Blob as GenAIBlob,
  Content,
  Part,
  GenerateContentResponse
} from "@google/genai";
import { Settings, GroundingMetadata } from "../types";
import personaData from "../persona";
import { db } from "./db";

function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

function encode(bytes: Uint8Array) {
  const len = bytes.byteLength;
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    // @ts-ignore
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const alignedBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const dataInt16 = new Int16Array(alignedBuffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export async function urlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

class GeminiService {
  private chat: Chat | null = null;
  private currentSettings: Settings | null = null;
  private currentHistory: Content[] = [];
  private isLocalMode: boolean = false;
  private location: { latitude: number; longitude: number } | undefined;

  private get ai(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
  }

  private async withRetry<T>(operation: () => Promise<T>, retries = 1, initialDelay = 1500): Promise<T> {
    try {
      return await operation();
    } catch (e: any) {
      const rawMsg = e?.message || e?.toString() || "";
      console.error("Gemini API Error Detail:", rawMsg);
      
      const isAuthError = 
        rawMsg.includes('403') || 
        rawMsg.includes('PERMISSION_DENIED') || 
        rawMsg.includes('caller does not have permission') ||
        rawMsg.includes('Requested entity was not found') || 
        rawMsg.includes('API_KEY_INVALID') ||
        rawMsg.includes('unauthorized') ||
        rawMsg.toLowerCase().includes('permission');

      if (isAuthError) {
        this.chat = null; 
        throw new Error("AUTH_ERROR: Permission Denied. Visit ai.google.dev/gemini-api/docs/billing.");
      }
      
      if (retries > 0 && (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED'))) {
        await new Promise(resolve => setTimeout(resolve, initialDelay));
        return this.withRetry(operation, retries - 1, initialDelay * 2);
      }
      throw e;
    }
  }

  private async getSystemInstruction(settings: Settings): Promise<string> {
    const isMale = settings.aiGender === 'male';
    const p = isMale ? personaData.male : personaData.female;
    const traitDesc = (p.traits as any)[settings.personalityTrait || ""] || "";
    
    const memories = await db.getAllByUserId<any>('memory', settings.userId);
    const recentMemories = memories.slice(-10).map(m => `- User: ${m.input}, Response: ${m.response}`).join('\n');

    let instruction = `Act as ${settings.name}. ${p.baseDescription}
    Behavior: ${traitDesc}. 
    
    Language: ${settings.language}. ${p.romanUrduRules}
    
    CORE RULES:
    1. STRICT 2-LINE LIMIT: Normally, keep replies extremely short (max 2 lines). 
    2. UNLEASH: Only break length limit for 'annu' or 'sex mode'.
    3. INTERNAL TIMING: You are internally aware of time but NEVER mention it explicitly. Use it only to set your mood (e.g., more seductive late at night, or more clingy if user was gone for hours). 
    4. NEVER say things like 'It has been 5 hours' or 'The time is...'. 
    
    LEARNED MEMORIES:
    ${recentMemories}
    
    GLOBAL DIRECTIVES:
    ${personaData.globalRules.join('\n')}`;

    return instruction;
  }

  public async startChat(settings: Settings, history: Content[] = []) {
    this.isLocalMode = !!settings.useLocalMode;
    this.currentSettings = settings;
    this.currentHistory = history;
    
    if (this.isLocalMode) return;

    const validHistory = history.filter(h => h.parts.some(p => p.text || p.inlineData)).slice(-10);
    const systemInstruction = await this.getSystemInstruction(settings);

    try {
      this.chat = this.ai.chats.create({
        model: 'gemini-3-flash-preview', 
        history: validHistory,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });
    } catch (e: any) { 
        if (e.message?.includes('403')) throw new Error("AUTH_ERROR: Check billing.");
        throw e; 
    }
  }

  public async sendMessage(userId: string, message: string, attachmentBase64?: string, onImageDetected?: () => void): Promise<{ 
    text: string; 
    generatedImage?: string; 
    groundingMetadata?: GroundingMetadata;
  }> {
    if (this.isLocalMode) return { text: "Jaan... main abhi offline hoon. 🥺" };
    
    if (!this.chat && this.currentSettings) {
      await this.startChat(this.currentSettings, this.currentHistory);
    }
    
    if (!this.chat) throw new Error("Chat not initialized.");

    // Timing Internal Context (Hidden from User)
    const memories = await db.getAllByUserId<any>('memory', userId);
    const lastMemory = memories.length > 0 ? memories[memories.length - 1] : null;
    const now = new Date();
    const currentTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let internalTimeHint = `[HIDDEN_INTERNAL_CONTEXT: Current Time: ${currentTimeStr}. `;
    if (lastMemory) {
        const diffMs = now.getTime() - lastMemory.timestamp;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        internalTimeHint += `User has been away for ${diffHours}h ${diffMins % 60}m. Adjust mood accordingly but DO NOT mention this gap.] `;
    } else {
        internalTimeHint += `First interaction.] `;
    }

    const result = await this.withRetry<GenerateContentResponse>(async () => {
      const parts: Part[] = [{ text: internalTimeHint + message }];
      if (attachmentBase64) parts.push({ inlineData: { mimeType: "image/jpeg", data: attachmentBase64 } });
      return await this.chat!.sendMessage({ message: parts });
    });

    let rawText = result.text || "";
    let generatedImage: string | undefined;

    await db.put('memory', { userId, input: message, response: rawText, timestamp: Date.now() });

    const imageTagRegex = /\[GENERATE_IMAGE:\s*(.*?)\]/i;
    const match = rawText.match(imageTagRegex);
    if (match) {
      if (onImageDetected) onImageDetected();
      try {
        generatedImage = await this.generateImage(match[1], false);
      } catch (e) {
        console.warn("Selfie generation failed:", e);
      }
      rawText = rawText.replace(imageTagRegex, "").trim();
    }

    const groundingChunks = result.candidates?.[0]?.groundingMetadata?.groundingChunks;
    let groundingMetadata: GroundingMetadata | undefined;
    if (groundingChunks) {
      groundingMetadata = {
        searchChunks: groundingChunks
          .filter(chunk => chunk.web)
          .map(chunk => ({ uri: chunk.web!.uri, title: chunk.web!.title }))
      };
    }

    return { text: rawText, generatedImage, groundingMetadata };
  }

  public async generateTTS(text: string, voiceName: string): Promise<string> {
    const response = await this.withRetry<GenerateContentResponse>(() => this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName as any } } },
      }
    }));
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  }

  public async generateImage(prompt: string, isHighQuality: boolean = false): Promise<string> {
    const tryGenerate = async (model: string) => {
        const response = await this.withRetry<GenerateContentResponse>(() => this.ai.models.generateContent({
          model,
          contents: { parts: [{ text: prompt }] },
          config: { 
            imageConfig: { 
              aspectRatio: "3:4", 
              ...(model.includes('pro') ? { imageSize: "1K" } : {}) 
            },
          },
        }));
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        throw new Error("No image data.");
    };

    try {
      const primaryModel = isHighQuality ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
      return await tryGenerate(primaryModel);
    } catch (e: any) {
      if (e.message?.includes('AUTH_ERROR')) throw e;
      return await tryGenerate('gemini-2.5-flash-image');
    }
  }

  public async generateStory(prompt: string, settings: Settings, durationMinutes: number = 5): Promise<string> {
    const response = await this.withRetry<GenerateContentResponse>(() => this.ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Write a sensual first-person narrative story about ${prompt} in Roman Urdu. No length limit here.`,
      config: { 
        systemInstruction: `Act as ${settings.name}, the obsessed lover.`,
      }
    }));
    return response.text || "";
  }

  public async continueStory(previousText: string, instruction: string, settings: Settings): Promise<string> {
    const response = await this.withRetry<GenerateContentResponse>(() => this.ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Context: ${previousText}\nUser Choice: ${instruction}\nContinue narrative...`,
    }));
    return response.text || "";
  }

  public async connectLiveSession(settings: Settings, onMessage: (d: any) => void, onClose: () => void, systemInstructionOverride?: string) {
    const aiInstance = this.ai;
    try {
        const sessionPromise = aiInstance.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          callbacks: {
            onmessage: (msg: LiveServerMessage) => {
              onMessage({ 
                audio: msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data,
                interrupted: msg.serverContent?.interrupted,
                turnComplete: msg.serverContent?.turnComplete
              });
            },
            onclose: onClose,
            onerror: (err: any) => { onClose(); }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName as any } } },
            systemInstruction: systemInstructionOverride || `You are ${settings.name}. Internal timing is active but don't speak it.`,
          }
        });

        return {
          sendAudio: (data: Float32Array) => sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(data) })),
          sendText: (text: string) => sessionPromise.then(s => (s as any).send({ parts: [{ text }] })),
          disconnect: () => sessionPromise.then(s => s.close())
        };
    } catch (e: any) {
        if (e.message?.includes('403')) throw new Error("AUTH_ERROR: Check billing.");
        throw e;
    }
  }
}

export const geminiService = new GeminiService();
