import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, MessageRole, Settings, ChatSession } from '../types';
import { geminiService, urlToBase64 } from '../services/geminiService';
import { db } from '../services/db';
import { Content } from "@google/genai";

interface ChatInterfaceProps {
  settings: Settings;
  onImageGenerated: (url: string, prompt: string) => void;
  onAuthError: () => void;
  sharedImage: string | null;
  onClearSharedImage: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  settings, 
  onImageGenerated, 
  onAuthError, 
  sharedImage, 
  onClearSharedImage 
}) => {
  // --- STATE ---
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [isDBLoaded, setIsDBLoaded] = useState(false);

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Typing...");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(0);
  const messagesRef = useRef(messages);

  // --- DB LOADING & SAVING ---

  // Load from DB on mount using userId
  useEffect(() => {
    const loadDB = async () => {
        try {
            const [savedMessages, savedHistory] = await Promise.all([
                db.getAllByUserId<ChatMessage>('active_chat', settings.userId),
                db.getAllByUserId<ChatSession>('chat_history', settings.userId)
            ]);
            
            // Sort by timestamp
            if (savedMessages.length > 0) {
                setMessages(savedMessages.sort((a, b) => a.timestamp - b.timestamp));
            } else {
                // Initial greeting if empty
                setMessages([{
                    id: 'init',
                    userId: settings.userId,
                    role: MessageRole.MODEL,
                    text: `Hii.. kaise ho? 🙈`,
                    timestamp: Date.now()
                }]);
            }

            if (savedHistory.length > 0) {
                setHistory(savedHistory.sort((a, b) => b.timestamp - a.timestamp));
            }
        } catch (e) {
            console.error("DB Load Error", e);
        } finally {
            setIsDBLoaded(true);
        }
    };
    loadDB();
  }, [settings.userId]);

  // Save active chat on change
  useEffect(() => {
    messagesRef.current = messages;
    if (isDBLoaded && messages.length > 0) {
        db.saveActiveChat(settings.userId, messages).catch(e => console.error("Auto-save failed", e));
    }
  }, [messages, isDBLoaded, settings.userId]);

  // --- INIT SERVICE ---

  useEffect(() => {
    if (!isDBLoaded) return;
    
    const initChat = async () => {
        const chatHistory: Content[] = messagesRef.current
            .filter(m => m.role !== MessageRole.SYSTEM)
            .map(m => ({
                role: m.role,
                parts: [{ text: m.text }] 
            }));

        await geminiService.startChat(settings, chatHistory);
    };
    initChat();
  }, [settings, isDBLoaded]);

  // --- SCROLLING ---
  
  useEffect(() => {
    const savedScroll = sessionStorage.getItem(`aura_chat_scroll_${settings.userId}`);
    if (scrollRef.current) {
        if (savedScroll) {
            scrollRef.current.scrollTop = parseInt(savedScroll, 10);
        } else {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }
  }, [isDBLoaded, settings.userId]);

  const handleScroll = () => {
      if (scrollRef.current) {
          sessionStorage.setItem(`aura_chat_scroll_${settings.userId}`, scrollRef.current.scrollTop.toString());
      }
  };

  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            sessionStorage.setItem(`aura_chat_scroll_${settings.userId}`, scrollRef.current.scrollTop.toString());
        }
    }
    prevMessagesLength.current = messages.length;
  }, [messages]);

  // --- HISTORY LOGIC ---

  const archiveCurrentSession = async () => {
    if (messages.length <= 1) return;
    const lastUserMsg = messages.slice().reverse().find(m => m.role === MessageRole.USER);
    const previewText = lastUserMsg ? lastUserMsg.text : "Conversation";
    
    const newSession: ChatSession = {
        id: Date.now().toString(),
        userId: settings.userId,
        timestamp: Date.now(),
        messages: [...messages],
        preview: previewText.length > 50 ? previewText.substring(0, 50) + "..." : previewText
    };
    
    setHistory(prev => [newSession, ...prev]);
    await db.put('chat_history', newSession);
  };

  const handleNewChat = async () => {
    if (messages.length > 1) {
        if (window.confirm("Start new chat? Current one will be saved.")) await archiveCurrentSession();
    }
    startFreshSession();
  };

  const startFreshSession = async () => {
      setMessages([]);
      sessionStorage.removeItem(`aura_chat_scroll_${settings.userId}`);
      setIsHistoryOpen(false);
      
      // Clear active chat in DB for this user
      await db.saveActiveChat(settings.userId, []);

      setTimeout(async () => {
          await geminiService.startChat(settings, []);
          setMessages([{
                id: Date.now().toString(),
                userId: settings.userId,
                role: MessageRole.MODEL,
                text: `Hii.. kaise ho? 🙈`,
                timestamp: Date.now()
          }]);
      }, 300);
  };

  const handleLoadSession = (session: ChatSession) => {
      if (messages.length > 1) archiveCurrentSession();
      setMessages(session.messages);
      setIsHistoryOpen(false);
      
      const chatHistory: Content[] = session.messages
        .filter(m => m.role !== MessageRole.SYSTEM)
        .map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      geminiService.startChat(settings, chatHistory);
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (window.confirm("Delete this conversation?")) {
          setHistory(prev => prev.filter(s => s.id !== id));
          await db.delete('chat_history', id);
      }
  };

  // --- HELPER: Find last image for context ---
  const getLastImageBase64 = async (): Promise<string | undefined> => {
      // Look backward through messages
      for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.image) {
              if (msg.image.startsWith('data:')) {
                  return msg.image.split(',')[1];
              } else {
                  try {
                      return await urlToBase64(msg.image);
                  } catch (e) {
                      console.warn("Failed to process context image", e);
                  }
              }
          }
      }
      return undefined;
  };

  // --- MESSAGING ---

  const handleSend = async () => {
    if ((!inputValue.trim() && !sharedImage) || isLoading) return;

    const textToSend = inputValue;
    const imageToSend = sharedImage; 

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      userId: settings.userId,
      role: MessageRole.USER,
      text: textToSend || (imageToSend ? "Check this out!" : ""),
      image: imageToSend || undefined,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    if (sharedImage) onClearSharedImage();
    
    setIsLoading(true);
    setLoadingStatus("Reading...");

    try {
        let attachmentBase64: string | undefined = undefined;
        let contextImageBase64: string | undefined = undefined;

        // 1. If user explicitly attached an image now
        if (imageToSend) {
            if (imageToSend.startsWith('data:')) {
                attachmentBase64 = imageToSend.split(',')[1];
            } else {
                attachmentBase64 = await urlToBase64(imageToSend);
            }
        } else {
            // 2. Otherwise, fetch the last available image in chat to use as "Context" if the user wants to edit it
            contextImageBase64 = await getLastImageBase64();
        }

        const response = await geminiService.sendMessage(
            settings.userId, 
            textToSend || "What do you think of this image?", 
            attachmentBase64,
            contextImageBase64 // Pass context image for editing features
        );
        
        const botMsg: ChatMessage = {
            id: Date.now().toString(),
            userId: settings.userId,
            role: MessageRole.MODEL,
            text: response.text,
            timestamp: Date.now(),
            groundingMetadata: response.groundingMetadata
        };

        if (response.generatedImage) {
            botMsg.image = response.generatedImage;
            onImageGenerated(response.generatedImage, textToSend);
        }

        setMessages(prev => [...prev, botMsg]);
    } catch (e: any) {
        console.error("Chat Error", e);
        if (e.message?.includes('403') || e.toString().includes('403')) {
            onAuthError();
        } else {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                userId: settings.userId,
                role: MessageRole.SYSTEM,
                text: "⚠️ Message failed. Please check connection.",
                timestamp: Date.now()
            }]);
        }
    } finally {
        setIsLoading(false);
        setLoadingStatus("Typing...");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
  };

  const formatTimestamp = (ts: number) => {
      return new Date(ts).toLocaleString([], { 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
      });
  };

  if (!isDBLoaded) {
      return <div className="flex items-center justify-center h-full bg-slate-950 text-slate-500">Loading History...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-slate-950/50 relative overflow-hidden">
        
        {/* HISTORY SIDEBAR */}
        <div className={`absolute inset-y-0 left-0 w-64 bg-slate-900/95 backdrop-blur-xl border-r border-slate-700 z-50 transform transition-transform duration-300 ease-in-out ${isHistoryOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex flex-col h-full">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-white font-serif text-lg">History</h3>
                    <button onClick={() => setIsHistoryOpen(false)} className="text-slate-400 hover:text-white"><i className="fas fa-times"></i></button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-hide">
                    {history.length === 0 ? (
                        <div className="text-center text-slate-500 mt-10 text-sm p-4">No archived chats.</div>
                    ) : (
                        history.map(session => (
                            <div key={session.id} onClick={() => handleLoadSession(session)} className="group p-3 rounded-xl bg-slate-800/50 hover:bg-slate-700 cursor-pointer border border-slate-700/50 transition-all relative">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[10px] text-rose-400 font-medium">{new Date(session.timestamp).toLocaleDateString()}</span>
                                    <button onClick={(e) => handleDeleteSession(e, session.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"><i className="fas fa-trash-alt text-xs"></i></button>
                                </div>
                                <p className="text-slate-300 text-xs line-clamp-2">{session.preview}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
        {isHistoryOpen && <div className="absolute inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={() => setIsHistoryOpen(false)}></div>}

        {/* HEADER */}
        <div className="flex-none h-16 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-4 z-10">
            <div className="flex items-center gap-3">
                <button onClick={() => setIsHistoryOpen(true)} className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white border border-slate-700 mr-1"><i className="fas fa-history text-xs"></i></button>
                <div className="relative">
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-rose-500">
                        <img src="https://picsum.photos/200/200" alt="Avatar" className="w-full h-full object-cover" />
                    </div>
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-slate-900 rounded-full"></div>
                </div>
                <div>
                    <h2 className="text-white font-medium text-sm leading-tight">{settings.name}</h2>
                    <p className="text-rose-400 text-xs">Online</p>
                </div>
            </div>
            <button onClick={handleNewChat} className="px-3 py-1.5 rounded-full bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 border border-slate-700 flex items-center gap-2"><i className="fas fa-plus"></i></button>
        </div>

        {/* MESSAGES */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
            {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === MessageRole.USER ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                        msg.role === MessageRole.USER ? 'bg-rose-600 text-white rounded-br-none' : 
                        msg.role === MessageRole.SYSTEM ? 'bg-red-900/50 text-red-200 text-center w-full border border-red-800/50' : 
                        'bg-slate-800 text-slate-200 rounded-bl-none'
                    }`}>
                        {msg.image && (
                            <div className="mb-2 rounded-lg overflow-hidden border border-white/20">
                                <img src={msg.image} alt="Attachment" className="w-full h-auto object-cover max-h-60" />
                            </div>
                        )}
                        {msg.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>}
                        
                        {msg.groundingMetadata && (
                            <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                                {msg.groundingMetadata.searchChunks?.map((chunk, i) => (
                                    <a key={i} href={chunk.uri} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-300 hover:underline truncate">
                                        <i className="fas fa-external-link-alt mr-1"></i> {chunk.title || chunk.uri}
                                    </a>
                                ))}
                            </div>
                        )}
                        <span className={`text-[10px] block mt-1 opacity-60 ${msg.role === MessageRole.USER ? 'text-rose-200 text-right' : 'text-slate-400'}`}>
                            {formatTimestamp(msg.timestamp)}
                        </span>
                    </div>
                </div>
            ))}
            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-slate-800 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2">
                        <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-xs text-slate-500 ml-1">{loadingStatus}</span>
                    </div>
                </div>
            )}
            <div className="h-1" />
        </div>

        {/* ATTACHMENT PREVIEW */}
        {sharedImage && (
            <div className="absolute bottom-20 left-4 right-4 bg-slate-800 rounded-xl p-3 border border-slate-700 flex items-center gap-3 shadow-2xl z-20 animate-slide-up">
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-900 flex-shrink-0">
                    <img src={sharedImage} alt="Preview" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-rose-400 font-medium">Attach Image</p>
                    <p className="text-[10px] text-slate-400 truncate">Discuss this with her...</p>
                </div>
                <button onClick={onClearSharedImage} className="w-8 h-8 rounded-full bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 flex items-center justify-center">
                    <i className="fas fa-times"></i>
                </button>
            </div>
        )}

        {/* INPUT AREA */}
        <div className="flex-none p-3 bg-slate-900 border-t border-slate-800">
            <div className="flex items-end gap-2 bg-slate-800 rounded-2xl p-2 border border-slate-700 focus-within:border-rose-500/50 transition-colors">
                <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={sharedImage ? "Add a caption..." : `Message ${settings.name}...`}
                    className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm resize-none max-h-32 min-h-[44px] p-3 focus:outline-none scrollbar-hide"
                    rows={1}
                />
                <button
                    onClick={handleSend}
                    disabled={(!inputValue.trim() && !sharedImage) || isLoading}
                    className="w-10 h-10 rounded-full bg-rose-600 disabled:bg-slate-700 text-white flex items-center justify-center transition-all hover:bg-rose-500 disabled:opacity-50 shadow-lg shadow-rose-900/20"
                >
                    {isLoading ? <i className="fas fa-spinner animate-spin text-sm"></i> : <i className="fas fa-paper-plane text-sm translate-x-px translate-y-px"></i>}
                </button>
            </div>
        </div>
    </div>
  );
};

export default ChatInterface;