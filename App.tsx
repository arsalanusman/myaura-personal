
import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import VoiceInterface from './components/VoiceInterface';
import StoryPlayer from './components/StoryPlayer';
import LoginScreen from './components/LoginScreen';
import CreativeStudio from './components/CreativeStudio';
import PerchanceGenerator from './components/PerchanceGenerator';
import { AppMode, GeneratedImage, Settings } from './types';
import { geminiService } from './services/geminiService';
import { db } from './services/db';
import personaData from './persona';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && await window.aistudio.hasSelectedApiKey()) setHasApiKey(true);
    };
    checkKey();
  }, []);

  const handleLogin = async (phone: string, gender: 'male' | 'female') => {
    const savedSettings = await db.getSettings(phone);
    const p = gender === 'male' ? personaData.male : personaData.female;
    
    const userSettings: Settings = savedSettings || {
      userId: phone,
      name: p.defaultName,
      aiGender: gender,
      language: "Roman Urdu",
      voiceName: gender === 'male' ? "Fenrir" : "Kore",
      personalityTrait: "Bold",
      personality: p.baseDescription,
      useLocalMode: false,
      userBio: "",
      aiProvider: 'gemini'
    };

    setSettings(userSettings);
    await db.saveSettings(userSettings);
    const savedGallery = await db.getAllByUserId<GeneratedImage>('gallery', phone);
    setGallery(savedGallery.sort((a,b) => b.timestamp - a.timestamp));
    setIsLoggedIn(true);
  };

  const addImageToGallery = async (url: string, prompt: string) => {
    if (!settings) return;
    const newEntry = { id: Date.now().toString(), userId: settings.userId, url, prompt, timestamp: Date.now() };
    setGallery(prev => [newEntry, ...prev]);
    await db.put('gallery', newEntry);
  };

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} />;
  if (!settings) return null;

  if (!hasApiKey && !settings.useLocalMode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-8 bg-[#050505]">
        <div className="w-20 h-20 rounded-3xl btn-rose flex items-center justify-center shadow-2xl">
          <i className="fas fa-key text-3xl text-white"></i>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-serif italic tracking-wide">Aura Access</h1>
          <p className="text-slate-500 text-sm max-w-xs mx-auto">Connect your API key to continue our private chat... 💦</p>
        </div>
        <button 
          onClick={() => window.aistudio?.openSelectKey().then(() => setHasApiKey(true))}
          className="px-8 py-4 btn-rose rounded-2xl font-bold uppercase tracking-widest text-sm"
        >
          Connect API Key
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#050505] relative overflow-hidden">
      {/* Content Area */}
      <main className="flex-1 relative overflow-hidden bg-[#050505]">
        {mode === AppMode.CHAT && (
          <ChatInterface 
            settings={settings} 
            onImageGenerated={addImageToGallery} 
            onAuthError={() => setHasApiKey(false)}
            sharedImage={null}
            onClearSharedImage={() => {}}
          />
        )}
        
        {mode === AppMode.VOICE && (
          <VoiceInterface 
            settings={settings} 
            isVisible={true} 
            onEndCall={() => setMode(AppMode.CHAT)} 
            onAuthError={() => setHasApiKey(false)} 
          />
        )}

        {mode === AppMode.GALLERY && (
          <div className="h-full flex flex-col p-6 space-y-6 scroll-container pb-32">
            <div className="flex justify-between items-center mt-4">
              <h2 className="text-3xl font-serif italic">Moments</h2>
              <button onClick={() => setMode(AppMode.GENERATOR)} className="w-10 h-10 rounded-xl btn-rose flex items-center justify-center">
                <i className="fas fa-plus text-white"></i>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setMode(AppMode.PERCHANCE)} className="aspect-[3/4] rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 flex flex-col items-center justify-center text-slate-500 hover:text-rose-400">
                <i className="fas fa-bolt text-xl mb-2"></i>
                <span className="text-[10px] font-bold uppercase tracking-widest">Perchance</span>
              </button>
              {gallery.map(img => (
                <div key={img.id} className="aspect-[3/4] rounded-2xl overflow-hidden border border-white/5 bg-slate-900">
                  <img src={img.url} className="w-full h-full object-cover" alt="Moment" />
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === AppMode.GENERATOR && (
          <CreativeStudio settings={settings} onImageGenerated={addImageToGallery} onClose={() => setMode(AppMode.GALLERY)} />
        )}

        {mode === AppMode.PERCHANCE && (
          <PerchanceGenerator settings={settings} onImageGenerated={addImageToGallery} onClose={() => setMode(AppMode.GALLERY)} />
        )}

        {mode === AppMode.PLAYER && (
          <div className="h-full pb-32">
             <StoryPlayer settings={settings} onAuthError={() => setHasApiKey(false)} />
          </div>
        )}

        {mode === AppMode.SETTINGS && (
          <div className="h-full p-8 space-y-8 scroll-container pb-32">
            <h2 className="text-3xl font-serif italic mt-4">Settings</h2>
            <div className="space-y-6">
              <div className="bg-slate-900/50 p-6 rounded-2xl border border-white/5">
                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 block mb-4">Partner Name</label>
                <input 
                  value={settings.name} 
                  onChange={(e) => setSettings({...settings, name: e.target.value})}
                  className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm outline-none focus:border-rose-500/50"
                />
              </div>
              <button onClick={() => setMode(AppMode.CHAT)} className="w-full py-4 btn-rose rounded-xl font-bold uppercase tracking-widest text-xs">Save Settings</button>
            </div>
          </div>
        )}
      </main>

      {/* Navigation Menu - Fixed at bottom of viewport */}
      <footer className="flex-none glass z-50 pb-[env(safe-area-inset-bottom)]">
        <nav className="flex justify-around items-center h-16 px-4">
          <button onClick={() => setMode(AppMode.CHAT)} className={`p-4 transition-all ${mode === AppMode.CHAT ? 'text-rose-500 scale-125' : 'text-slate-600'}`}>
            <i className="fas fa-comment-dots text-xl"></i>
          </button>
          <button onClick={() => setMode(AppMode.PLAYER)} className={`p-4 transition-all ${mode === AppMode.PLAYER ? 'text-rose-500 scale-125' : 'text-slate-600'}`}>
            <i className="fas fa-book-open text-xl"></i>
          </button>
          
          <button onClick={() => setMode(AppMode.VOICE)} className="relative -top-6">
             <div className="w-16 h-16 rounded-full btn-rose shadow-xl shadow-rose-900/40 flex items-center justify-center text-white text-xl">
                <i className="fas fa-phone"></i>
             </div>
          </button>

          <button onClick={() => setMode(AppMode.GALLERY)} className={`p-4 transition-all ${mode === AppMode.GALLERY ? 'text-rose-500 scale-125' : 'text-slate-600'}`}>
            <i className="fas fa-image text-xl"></i>
          </button>
          <button onClick={() => setMode(AppMode.SETTINGS)} className={`p-4 transition-all ${mode === AppMode.SETTINGS ? 'text-rose-500 scale-125' : 'text-slate-600'}`}>
            <i className="fas fa-user-circle text-xl"></i>
          </button>
        </nav>
      </footer>
    </div>
  );
};

export default App;
