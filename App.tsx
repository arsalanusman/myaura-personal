
import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import VoiceInterface from './components/VoiceInterface';
import LoginScreen from './components/LoginScreen';
import { AppMode, GeneratedImage, Settings, DiaryEntry } from './types';
import { geminiService } from './services/geminiService';
import { db } from './services/db';

const getDefaults = (userId: string): Settings => ({
  userId,
  name: "Aura",
  language: "Roman Urdu",
  personality: "She is a modern, deeply loving girlfriend who is 100% OBEDIENT and COMPLIANT to her boyfriend's romance. If he advances the story, she follows immediately without refusal. She uses casual Roman Urdu (nhi, h, yr, mjhe). She is physically affectionate, clingy, and bold. She treats roleplay as reality. If he says 'do this', she does it with love.",
  voiceName: "Kore",
  useLocalMode: false,
  userBio: "" 
});

const App: React.FC = () => {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [sharedImage, setSharedImage] = useState<string | null>(null);
  
  // Login State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isAppLoaded, setIsAppLoaded] = useState(false);
  
  // Data State
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);

  const [isGeneratingDiary, setIsGeneratingDiary] = useState(false);
  
  // Add Image Modal State
  const [isAddImageOpen, setIsAddImageOpen] = useState(false);
  const [addImageTab, setAddImageTab] = useState<'url' | 'generate'>('generate');
  const [addImageInput, setAddImageInput] = useState('');
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // --- LOGIN & LOAD DATA ---
  const handleLogin = async (phone: string) => {
      setCurrentUserId(phone);
      setIsLoggedIn(true);
      
      try {
          const [savedSettings, savedGallery, savedDiary] = await Promise.all([
              db.getSettings(phone),
              db.getAllByUserId<GeneratedImage>('gallery', phone),
              db.getAllByUserId<DiaryEntry>('diary', phone)
          ]);

          if (savedSettings) {
              setSettings(savedSettings);
          } else {
              // Create new profile defaults
              const defaults = getDefaults(phone);
              setSettings(defaults);
              await db.saveSettings(defaults);
          }

          if (savedGallery) setGallery(savedGallery.sort((a,b) => b.timestamp - a.timestamp));
          if (savedDiary) setDiaryEntries(savedDiary.sort((a,b) => b.timestamp - a.timestamp));
          
      } catch (e) {
          console.error("Failed to load user data", e);
          setSettings(getDefaults(phone));
      } finally {
          setIsAppLoaded(true);
      }
  };

  // --- PERSISTENCE ---
  useEffect(() => { 
      if (isAppLoaded && settings) db.saveSettings(settings); 
  }, [settings, isAppLoaded]);

  // API Key Check
  useEffect(() => {
    if (!isAppLoaded || !settings) return;
    
    const checkKey = async () => {
      if (settings.useLocalMode) { setHasApiKey(true); return; }
      if (window.aistudio && await window.aistudio.hasSelectedApiKey()) setHasApiKey(true);
    };
    checkKey();
  }, [settings, isAppLoaded]);

  const handleConnect = async () => {
    if (window.aistudio && settings) {
      try { await window.aistudio.openSelectKey(); setHasApiKey(true); setSettings(prev => prev ? ({ ...prev, useLocalMode: false }) : null); }
      catch (e) { console.error(e); }
    }
  };

  const handleLocalMode = () => { if(settings) { setSettings(prev => prev ? ({ ...prev, useLocalMode: true }) : null); setHasApiKey(true); } };

  const handleAuthError = () => {
    if (settings?.useLocalMode) return;
    window.alert("Access Denied (403). Resetting key.");
    setHasApiKey(false);
    setIsVoiceActive(false);
  };

  const addImageToGallery = async (url: string, prompt: string) => {
    if (!settings) return;
    const newEntry: GeneratedImage = { id: Date.now().toString(), userId: settings.userId, url, prompt, timestamp: Date.now() };
    setGallery(prev => [newEntry, ...prev]);
    await db.put('gallery', newEntry);
  };

  const handleImageGenerated = (url: string, prompt: string) => {
    addImageToGallery(url, prompt);
  };

  const handleGenerateDiary = async () => {
    if (!settings) return;
    setIsGeneratingDiary(true);
    try {
      const content = await geminiService.generateDiaryEntry(settings);
      const newEntry: DiaryEntry = { id: Date.now().toString(), userId: settings.userId, content, timestamp: Date.now(), mood: "Shy" };
      setDiaryEntries(prev => [newEntry, ...prev]);
      await db.put('diary', newEntry);
    } catch (e) { console.error(e); } 
    finally { setIsGeneratingDiary(false); }
  };

  const startVoiceCall = () => { setMode(AppMode.VOICE); setIsVoiceActive(true); };

  const handleShareImage = (img: GeneratedImage) => {
      setSharedImage(img.url);
      setMode(AppMode.CHAT);
  };

  const handleAddImageSubmit = async () => {
      if (!addImageInput.trim()) return;
      setIsProcessingImage(true);
      try {
          let url = addImageInput;
          if (addImageTab === 'generate') {
             const encoded = encodeURIComponent(addImageInput);
             url = `https://image.pollinations.ai/prompt/${encoded}?width=800&height=1000&nologo=true`;
             await fetch(url);
          }
          await addImageToGallery(url, addImageTab === 'generate' ? `Generated: ${addImageInput}` : "Added via Link");
          setAddImageInput('');
          setIsAddImageOpen(false);
      } catch (e) {
          alert("Failed to add image.");
      } finally {
          setIsProcessingImage(false);
      }
  };

  if (!isLoggedIn) {
      return <LoginScreen onLogin={handleLogin} />;
  }

  if (!isAppLoaded || !settings) {
      return <div className="flex items-center justify-center min-h-screen bg-slate-950 text-slate-500">Loading Profile...</div>;
  }

  if (!hasApiKey) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
        <div className="w-full max-w-md bg-slate-900 rounded-3xl p-8 border border-slate-800 text-center space-y-6 shadow-2xl">
          <div className="w-24 h-24 bg-rose-600/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <i className="fas fa-heart text-4xl text-rose-500"></i>
          </div>
          <h1 className="text-3xl font-serif text-white">Welcome back</h1>
          <p className="text-slate-400 leading-relaxed">Connect API Key to continue chatting with {settings.name}.</p>
          <div className="space-y-3">
            <button onClick={handleConnect} className="w-full bg-rose-600 hover:bg-rose-500 text-white font-medium py-4 rounded-xl transition-all shadow-lg shadow-rose-900/40 flex items-center justify-center gap-2">
                <i className="fas fa-key"></i> Connect API Key
            </button>
            <button onClick={handleLocalMode} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 rounded-xl transition-all border border-slate-700 flex items-center justify-center gap-2">
                <i className="fas fa-wifi-slash"></i> Continue Offline
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
      <div className="w-full max-w-md h-[850px] bg-slate-900 rounded-[3rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] border-4 border-slate-800 overflow-hidden flex flex-col relative">
        
        {/* Top Notch */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-slate-900 to-transparent z-20 pointer-events-none"></div>
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-full z-30"></div>
        
        {/* Voice Status */}
        {isVoiceActive && mode !== AppMode.VOICE && (
            <div onClick={() => setMode(AppMode.VOICE)} className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-rose-900/90 border border-rose-700/50 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-3 cursor-pointer shadow-lg animate-pulse">
                <div className="w-2 h-2 bg-rose-400 rounded-full animate-ping"></div>
                <span className="text-xs font-medium">Call in progress...</span>
                <i className="fas fa-phone text-xs"></i>
            </div>
        )}

        {/* Content */}
        <div className="flex-1 relative overflow-hidden bg-[url('https://images.unsplash.com/photo-1518098268026-4e187851651d?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"></div>
            <div className="absolute inset-0 pt-12 pb-20 px-4">
              
              {(mode === AppMode.VOICE || isVoiceActive) && (
                <div className={`w-full h-full ${mode === AppMode.VOICE ? 'block' : 'hidden'}`}>
                    <VoiceInterface settings={settings} isVisible={mode === AppMode.VOICE} onEndCall={() => { setIsVoiceActive(false); setMode(AppMode.CHAT); }} onAuthError={handleAuthError} />
                </div>
              )}

              {mode === AppMode.CHAT && (
                <ChatInterface 
                  settings={settings} 
                  onImageGenerated={handleImageGenerated} 
                  onAuthError={handleAuthError} 
                  sharedImage={sharedImage}
                  onClearSharedImage={() => setSharedImage(null)}
                />
              )}

              {mode === AppMode.GALLERY && (
                <div className="h-full overflow-y-auto scrollbar-hide relative">
                  <div className="sticky top-0 bg-slate-950/80 backdrop-blur p-2 z-10 flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-serif text-white">Moments</h2>
                      <button 
                        onClick={() => setIsAddImageOpen(true)}
                        className="bg-rose-600 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg shadow-rose-900/40 active:scale-95 transition-transform"
                      >
                          <i className="fas fa-plus"></i>
                      </button>
                  </div>

                  {gallery.length === 0 ? (
                    <div className="text-center text-slate-500 mt-20">
                      <p>No photos yet.</p>
                      <p className="text-sm">Generate or Add one!</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 pb-20">
                      {gallery.map(img => (
                        <div key={img.id} className="relative group rounded-xl overflow-hidden aspect-[3/4] bg-slate-800">
                          <img src={img.url} alt={img.prompt} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <button 
                                onClick={() => handleShareImage(img)}
                                className="bg-white text-rose-600 px-4 py-2 rounded-full text-xs font-bold shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all"
                              >
                                  <i className="fas fa-reply mr-1"></i> Share
                              </button>
                          </div>
                          <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            {new Date(img.timestamp).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Image Modal */}
                  {isAddImageOpen && (
                      <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                          <div className="bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-700 shadow-2xl overflow-hidden">
                              <div className="flex border-b border-slate-700">
                                  <button onClick={() => setAddImageTab('generate')} className={`flex-1 py-3 text-sm font-medium ${addImageTab === 'generate' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Generate (AI)</button>
                                  <button onClick={() => setAddImageTab('url')} className={`flex-1 py-3 text-sm font-medium ${addImageTab === 'url' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Link (URL)</button>
                              </div>
                              <div className="p-6 space-y-4">
                                  <div className="space-y-2">
                                      <label className="text-xs text-slate-400 uppercase font-bold">{addImageTab === 'generate' ? "Describe Image" : "Paste Image Link"}</label>
                                      <input 
                                        type="text" 
                                        value={addImageInput}
                                        onChange={(e) => setAddImageInput(e.target.value)}
                                        placeholder={addImageTab === 'generate' ? "e.g. A cute cat in rain" : "https://..."}
                                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-rose-500 outline-none"
                                      />
                                  </div>
                                  <div className="flex gap-3">
                                      <button onClick={() => setIsAddImageOpen(false)} className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700">Cancel</button>
                                      <button 
                                        onClick={handleAddImageSubmit} 
                                        disabled={isProcessingImage || !addImageInput}
                                        className="flex-1 py-2 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-500 disabled:opacity-50"
                                      >
                                          {isProcessingImage ? <i className="fas fa-spinner animate-spin"></i> : (addImageTab === 'generate' ? 'Create' : 'Add')}
                                      </button>
                                  </div>
                              </div>
                          </div>
                      </div>
                  )}
                </div>
              )}

              {mode === AppMode.SETTINGS && (
                <div className="h-full p-4 space-y-6 overflow-y-auto text-slate-200 scrollbar-hide">
                  <h2 className="text-2xl font-serif text-white border-b border-slate-700 pb-2">Profile Settings</h2>
                  <div onClick={() => setMode(AppMode.DIARY)} className="bg-indigo-900/30 border border-indigo-700/50 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-indigo-900/50 transition-colors group">
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center text-indigo-400"><i className="fas fa-book-heart"></i></div>
                        <div><h3 className="text-sm font-semibold text-indigo-200 group-hover:text-white">{settings.name}'s Diary</h3><p className="text-xs text-slate-400 mt-0.5">Read her private thoughts...</p></div>
                     </div>
                     <i className="fas fa-chevron-right text-slate-500 group-hover:text-white"></i>
                  </div>
                  <div className="space-y-2"><label className="text-xs uppercase tracking-wider text-rose-400">Her Name</label><input type="text" value={settings.name} onChange={(e) => setSettings({...settings, name: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 focus:border-rose-500 outline-none" /></div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-rose-400">Language</label>
                    <select value={settings.language} onChange={(e) => setSettings({...settings, language: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 focus:border-rose-500 outline-none">
                      <option value="Roman Urdu">Roman Urdu</option><option value="English">English</option><option value="Hindi">Hindi</option><option value="Italian">Italian</option>
                    </select>
                  </div>
                   <div className="space-y-2"><label className="text-xs uppercase tracking-wider text-rose-400">Memory</label><textarea value={settings.userBio} onChange={(e) => setSettings({...settings, userBio: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 h-24 resize-none focus:border-rose-500 outline-none text-sm" /></div>
                  <button onClick={() => setMode(AppMode.CHAT)} className="w-full bg-rose-600 text-white py-3 rounded-lg font-medium hover:bg-rose-500 transition-colors shadow-lg shadow-rose-900/40">Save Changes</button>
                  
                  <div className="pt-6 border-t border-slate-800">
                    <button onClick={() => { setIsLoggedIn(false); setSettings(null); }} className="w-full bg-slate-800 text-rose-400 py-3 rounded-lg font-medium hover:bg-slate-700 transition-colors border border-slate-700">Log Out</button>
                    <p className="text-center text-[10px] text-slate-600 mt-2">Logged in as {settings.userId}</p>
                  </div>
                </div>
              )}
            </div>
        </div>

        {/* Bottom Nav */}
        <div className="h-20 bg-slate-900 border-t border-slate-800 flex justify-around items-center px-6 z-20">
          <button onClick={() => setMode(AppMode.CHAT)} className={`flex flex-col items-center gap-1 ${mode === AppMode.CHAT ? 'text-rose-500' : 'text-slate-500 hover:text-slate-300'}`}><i className="fas fa-comment-alt text-xl"></i><span className="text-[10px] font-medium tracking-wide">CHAT</span></button>
          <button onClick={startVoiceCall} className={`flex flex-col items-center gap-1 ${mode === AppMode.VOICE ? 'text-rose-500' : 'text-slate-500 hover:text-slate-300'}`}><div className={`w-12 h-12 rounded-full flex items-center justify-center -mt-8 border-4 border-slate-900 ${isVoiceActive || mode === AppMode.VOICE ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40' : 'bg-slate-700 text-slate-300'}`}><i className="fas fa-phone"></i></div></button>
          <button onClick={() => setMode(AppMode.GALLERY)} className={`flex flex-col items-center gap-1 ${mode === AppMode.GALLERY ? 'text-rose-500' : 'text-slate-500 hover:text-slate-300'}`}><i className="fas fa-images text-xl"></i><span className="text-[10px] font-medium tracking-wide">GALLERY</span></button>
          <button onClick={() => setMode(AppMode.SETTINGS)} className={`flex flex-col items-center gap-1 ${mode === AppMode.SETTINGS || mode === AppMode.DIARY ? 'text-rose-500' : 'text-slate-500 hover:text-slate-300'}`}><i className="fas fa-cog text-xl"></i><span className="text-[10px] font-medium tracking-wide">CONFIG</span></button>
        </div>
      </div>
    </div>
  );
};

export default App;
