
import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, MessageRole, Settings } from '../types';
import { geminiService, urlToBase64, decode, decodeAudioData } from '../services/geminiService';
import { db } from '../services/db';
import { Content } from "@google/genai";

interface ChatInterfaceProps {
  settings: Settings;
  onImageGenerated: (url: string, prompt: string) => void;
  onAuthError: (message?: string) => void;
  sharedImage: string | null;
  onClearSharedImage: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ settings, onImageGenerated, onAuthError }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCapturingSelfie, setIsCapturingSelfie] = useState(false);
  const [lastActiveText, setLastActiveText] = useState('Active 💦');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadChat = async () => {
      const saved = await db.getAllByUserId<ChatMessage>('active_chat', settings.userId);
      if (saved.length > 0) setMessages(saved.sort((a,b) => a.timestamp - b.timestamp));
      else setMessages([{ 
        id: 'init', userId: settings.userId, role: MessageRole.MODEL, 
        text: "Jaan... barish bohot ho rahi hai, tumhare bina dil nahi lag raha... 💦❤️", 
        timestamp: Date.now() 
      }]);
    };
    loadChat();
  }, [settings.userId]);

  // Dynamic Last Active calculation
  useEffect(() => {
    const updateLastActive = () => {
      if (messages.length === 0) return;
      const lastMsg = messages[messages.length - 1];
      const diffMs = Date.now() - lastMsg.timestamp;
      const mins = Math.floor(diffMs / 60000);
      
      if (mins < 1) setLastActiveText('Just now 💦');
      else if (mins < 60) setLastActiveText(`${mins}m ago 💦`);
      else {
        const hours = Math.floor(mins / 60);
        setLastActiveText(`${hours}h ago 💦`);
      }
    };

    updateLastActive();
    const interval = setInterval(updateLastActive, 60000);
    return () => clearInterval(interval);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    db.saveActiveChat(settings.userId, messages);
    
    const history: Content[] = messages
        .filter(m => m.role !== MessageRole.SYSTEM)
        .map(m => ({ role: m.role, parts: [{ text: m.text }] }));
    
    geminiService.startChat(settings, history).catch(e => {
        if (e.message?.includes('AUTH_ERROR')) onAuthError(e.message);
    });
  }, [messages, settings]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    const text = inputValue;
    const userMsg: ChatMessage = { id: Date.now().toString(), userId: settings.userId, role: MessageRole.USER, text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);
    setIsCapturingSelfie(false);

    try {
      const response = await geminiService.sendMessage(
        settings.userId, 
        text, 
        undefined, 
        () => setIsCapturingSelfie(true)
      );
      
      const botMsg: ChatMessage = { 
        id: Date.now().toString(), userId: settings.userId, 
        role: MessageRole.MODEL, text: response.text, 
        image: response.generatedImage, timestamp: Date.now(),
        groundingMetadata: response.groundingMetadata
      };
      
      if (response.generatedImage) onImageGenerated(response.generatedImage, text);
      setMessages(prev => [...prev, botMsg]);
    } catch (e: any) {
      console.error("Chat Error:", e);
      if (e.message?.includes('AUTH_ERROR')) {
        onAuthError(e.message);
      } else {
        alert(e.message || "Something went wrong. Please try again.");
      }
    } finally {
      setIsLoading(false);
      setIsCapturingSelfie(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050505]">
      {/* Sticky Header */}
      <header className="h-14 flex-none flex items-center px-6 justify-between border-b border-white/5 bg-black/40 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border border-rose-500/40 overflow-hidden">
            <img 
              src={settings.aiGender === 'male' ? "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100" : "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100"} 
              className="w-full h-full object-cover" 
              alt="Avatar"
            />
          </div>
          <div>
            <h2 className="text-sm font-bold">{settings.name}</h2>
            <div className="flex items-center gap-1.5">
               <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
               <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{lastActiveText}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Message Stream */}
      <div ref={scrollRef} className="flex-1 scroll-container px-4 py-6 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === MessageRole.USER ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${msg.role === MessageRole.USER ? 'text-right' : 'text-left'}`}>
              <div className={`rounded-2xl px-4 py-3 text-[14px] leading-relaxed shadow-lg ${msg.role === MessageRole.USER 
                ? 'bg-rose-600 text-white rounded-tr-none' 
                : 'bg-slate-900 text-slate-100 rounded-tl-none border border-white/5'}`}>
                
                {msg.image && (
                  <div className="mb-2 rounded-xl overflow-hidden bg-black/20">
                    <img src={msg.image} className="w-full h-auto object-cover max-h-96" alt="Generated" />
                  </div>
                )}
                
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {msg.groundingMetadata?.searchChunks && msg.groundingMetadata.searchChunks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                    <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Sources 🌐</p>
                    {msg.groundingMetadata.searchChunks.map((chunk, idx) => (
                      <a 
                        key={idx} 
                        href={chunk.uri} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="block text-[11px] text-rose-400 hover:underline truncate"
                      >
                        {chunk.title || chunk.uri}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-900/50 px-4 py-2 rounded-xl text-[11px] italic text-rose-400 border border-rose-500/10 animate-pulse flex items-center gap-2">
              <i className={`fas ${isCapturingSelfie ? 'fa-camera' : 'fa-comment-dots'}`}></i>
              {isCapturingSelfie ? 'Capturing selfie... 📸💦' : `${settings.name} is typing... 💦`}
            </div>
          </div>
        )}
        <div className="h-24 flex-none"></div>
      </div>

      {/* Input Bar */}
      <div className="absolute bottom-4 left-0 right-0 px-4 z-40 pointer-events-none">
        <div className="flex items-end gap-2 bg-slate-900 border border-white/10 p-2 rounded-2xl pointer-events-auto shadow-2xl backdrop-blur-lg">
          <textarea 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
            placeholder="Satisfy me... 💦"
            className="flex-1 bg-transparent text-white px-3 py-3 outline-none resize-none text-sm max-h-32 placeholder:text-slate-600"
            rows={1}
          />
          <button 
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="w-12 h-12 flex-none rounded-xl btn-rose flex items-center justify-center text-white disabled:opacity-30 transition-all active:scale-95"
          >
            <i className="fas fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
