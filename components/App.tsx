
import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import VoiceInterface from './components/VoiceInterface';
import StoryPlayer from './components/StoryPlayer';
import LoginScreen from './components/LoginScreen';
import CreativeStudio from './components/CreativeStudio';
import PerchanceGenerator from './components/PerchanceGenerator';
import { AppMode, GeneratedImage, Settings } from '../types';
import { geminiService } from '../services/geminiService';
import { db } from '../services/db';
import personaData from '../persona';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
        setHasApiKey(true);
        setAuthErrorMessage(null);
      }
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

  const handleAuthError = (message?: string) => {
    console.error("Auth error triggered:", message);
    setHasApiKey(false);
    // Extract a cleaner message if it's a JSON string or specific AUTH_ERROR
    let cleanMessage = message || "Permission Denied (403).";
    if (cleanMessage.includes('AUTH_ERROR:')) {
      cleanMessage = cleanMessage.split('AUTH_ERROR:')[1].trim();
    }
    setAuthErrorMessage(cleanMessage);
  };

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} />;
  if (!settings) return null;

  if (!hasApiKey && !settings.useLocalMode) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-8 bg-[#050505] overflow-y-auto">
        <div className="w-20 h-20 rounded-3xl btn-rose flex items-center justify-center shadow-2xl animate-pulse">
          <i className="fas fa-lock-open text-3xl text-white"></i>
        </div>
        <div className="space-y-4 max-w-sm">
          <h1 className="text-3xl font-serif italic tracking-wide">Connect API Key</h1>
          
          <div className="bg-rose-950/20 border border-rose-500/20 p-6 rounded-3xl text-rose-300 text-[11px] leading-relaxed text-left space-y-4">
            <p className="font-bold flex items-center gap-2 text-xs uppercase tracking-tighter">
              <i className="fas fa-exclamation-circle text-rose-500"></i>
              Authorization Required
            </p>
            <p className="opacity-90">{authErrorMessage || "To access advanced Gemini features and high-quality image generation, you must connect an API key from a project with billing enabled."}</p>
            <div className="pt-2 space-y-2 border-t border-rose-500/10">
              <p className="font-bold text-white uppercase tracking-tighter text-[9px]">Required Steps:</p>
              <ul className="list-disc pl-4 space-y-2 opacity-80 text-[10px]">
                <li>Visit <a href="https://aistudio.google.com/" target="_blank" className="underline font-bold text-white">Google AI Studio</a>.</li>
                <li>Switch to a project with <strong>Billing Enabled</strong>.</li>
                <li>Advanced models like Gemini 3 and Pro Imaging require a <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline font-bold text-white">Paid Tier Project</a>.</li>
                <li>Click the button below to select your key.</li>
              </ul>
            </div>
          </div>
        </div>

        <button 
          onClick={() => window.aistudio?.openSelectKey().then(() => {
            setHasApiKey(true);
            setAuthErrorMessage(null);
          })}
          className="w-full max-w-xs py-5 btn-rose rounded-[2rem] font-bold uppercase tracking-widest text-sm shadow-xl shadow-rose-900/40 active:scale-95 transition-all"
        >
          Select Paid API Key
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full max-w-2xl mx-auto flex flex-col bg-[#050505] relative shadow-2xl overflow-hidden">
      
      {/* Dynamic Content Area */}
      <main className="flex-1 relative overflow-hidden">
        {mode === AppMode.CHAT && (
          <ChatInterface 
            settings={settings} 
            onImageGenerated={addImageToGallery} 
            onAuthError={handleAuthError}
            sharedImage={null}
            onClearSharedImage={() => {}}
          />
        )}
        
        {mode === AppMode.VOICE && (
          <VoiceInterface 
            settings={settings} 
            isVisible={true} 
            onEndCall={() => setMode(AppMode.CHAT)} 
            onAuthError={() => handleAuthError("Live session auth failed. Please re-select a paid API key.")} 
          />
        )}

        {mode === AppMode.GALLERY && (
          <div className="h-full flex flex-col p-6 space-y-8 scroll-container pb-40">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-4xl font-serif italic tracking-wide">Moments</h2>
                <p className="text-rose-500/60 text-[10px] uppercase font-bold tracking-[0.3em] mt-1">Media Archive</p>
              </div>
              <button onClick={() => setMode(AppMode.GENERATOR)} className="w-12 h-12 rounded-2xl btn-rose flex items-center justify-center">
                <i className="fas fa-magic text-lg text-white"></i>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setMode(AppMode.GENERATOR)} className="aspect-[3/4] rounded-3xl border border-dashed border-slate-800 bg-slate-900/20 flex flex-col items-center justify-center space-y-3 group hover:border-rose-500/30 transition-all">
                <i className="fas fa-brush text-2xl text-slate-700 group-hover:text-rose-500"></i>
                <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Arting Pro</span>
              </button>
              <button onClick={() => setMode(AppMode.PERCHANCE)} className="aspect-[3/4] rounded-3xl border border-dashed border-slate-800 bg-slate-900/20 flex flex-col items-center justify-center space-y-3 group hover:border-rose-500/30 transition-all">
                <i className="fas fa-bolt text-2xl text-slate-700 group-hover:text-rose-500"></i>
                <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Perchance</span>
              </button>
              {gallery.map(img => (
                <div key={img.id} className="aspect-[3/4] rounded-3xl overflow-hidden border border-white/5 relative group">
                  <img src={img.url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt="Gallery" />
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
          <div className="h-full pb-40">
             <StoryPlayer settings={settings} onAuthError={() => handleAuthError("Story generation failed. A paid project key is required.")} />
          </div>
        )}

        {mode === AppMode.SETTINGS && (
          <div className="h-full p-8 space-y-12 scroll-container pb-40">
            <h2 className="text-4xl font-serif italic tracking-wide">Config</h2>
            <div className="space-y-8">
              <div className="space-y-4">
                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 ml-1">Persona Name</label>
                <input 
                  value={settings.name} 
                  onChange={(e) => setSettings({...settings, name: e.target.value})}
                  className="w-full h-16 bg-slate-900/50 border border-white/5 rounded-2xl px-6 outline-none focus:border-rose-500/50 transition-all"
                />
              </div>
              <button onClick={() => setMode(AppMode.CHAT)} className="w-full h-16 btn-rose rounded-2xl font-bold uppercase tracking-widest text-sm text-white">Apply Changes</button>
            </div>
          </div>
        )}
      </main>

      {/* Modern Navigation Dock */}
      <div className="absolute bottom-6 left-0 right-0 px-6 z-[100] pointer-events-none">
        <nav className="mx-auto max-w-md h-16 glass rounded-[2rem] flex justify-around items-center px-4 pointer-events-auto aura-glow">
          <button onClick={() => setMode(AppMode.CHAT)} className={`p-3 transition-all ${mode === AppMode.CHAT ? 'text-rose-500 scale-125' : 'text-slate-600 hover:text-slate-400'}`}>
            <i className="fas fa-comment-dots text-xl"></i>
          </button>
          <button onClick={() => setMode(AppMode.PLAYER)} className={`p-3 transition-all ${mode === AppMode.PLAYER ? 'text-rose-500 scale-125' : 'text-slate-600 hover:text-slate-400'}`}>
            <i className="fas fa-book-open text-xl"></i>
          </button>
          <button onClick={() => setMode(AppMode.VOICE)} className={`w-14 h-14 -mt-10 rounded-2xl btn-rose text-white shadow-xl rotate-45 flex items-center justify-center transition-transform active:scale-90 ${mode === AppMode.VOICE ? 'scale-110' : ''}`}>
            <i className="fas fa-phone -rotate-45 text-xl"></i>
          </button>
          <button onClick={() => setMode(AppMode.GALLERY)} className={`p-3 transition-all ${mode === AppMode.GALLERY ? 'text-rose-500 scale-125' : 'text-slate-600 hover:text-slate-400'}`}>
            <i className="fas fa-photo-film text-xl"></i>
          </button>
          <button onClick={() => setMode(AppMode.SETTINGS)} className={`p-3 transition-all ${mode === AppMode.SETTINGS ? 'text-rose-500 scale-125' : 'text-slate-600 hover:text-slate-400'}`}>
            <i className="fas fa-sliders-h text-xl"></i>
          </button>
        </nav>
      </div>
    </div>
  );
};

export default App;
