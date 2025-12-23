
import React, { useState, useEffect, useRef } from 'react';
import { geminiService, decode, decodeAudioData } from '../services/geminiService';
import { Settings, SavedStory } from '../types';
import { db } from '../services/db';

interface StoryPlayerProps {
  settings: Settings;
  onAuthError: () => void;
}

const StoryPlayer: React.FC<StoryPlayerProps> = ({ settings, onAuthError }) => {
  const [view, setView] = useState<'player' | 'library'>('library');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [newPrompt, setNewPrompt] = useState(""); 
  const [savedStories, setSavedStories] = useState<SavedStory[]>([]);
  const [activeStory, setActiveStory] = useState<SavedStory | null>(null);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("Ready");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef(0);
  const startTimeRef = useRef(0);
  const playbackOffsetRef = useRef(0);

  const isMale = settings.aiGender === 'male';
  const themeAccent = isMale ? 'blue' : 'rose';
  const textAccent = isMale ? 'text-blue-400' : 'text-rose-400';
  const bgAccent = isMale ? 'bg-blue-600' : 'bg-rose-600';

  useEffect(() => {
    loadLibrary();
    return () => stopPlayback();
  }, []);

  const loadLibrary = async () => {
    const stories = await db.getAllByUserId<SavedStory>('saved_stories', settings.userId);
    setSavedStories(stories.sort((a,b) => b.timestamp - a.timestamp));
  };

  useEffect(() => {
    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      if (analyserRef.current && canvasRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          const w = canvasRef.current.width;
          const h = canvasRef.current.height;
          ctx.clearRect(0, 0, w, h);
          const barWidth = (w / data.length) * 2;
          let x = 0;
          for (let i = 0; i < data.length; i++) {
            const barHeight = (data[i] / 255) * h * 0.8;
            ctx.fillStyle = isMale ? `rgba(59, 130, 246, ${data[i]/255})` : `rgba(244, 63, 94, ${data[i]/255})`;
            ctx.fillRect(x, h - barHeight, barWidth, barHeight);
            x += barWidth + 1;
          }
        }
      }
      
      if (isPlaying && duration > 0) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const totalElapsed = playbackOffsetRef.current + elapsed;
        setCurrentTime(Math.min(totalElapsed, duration));
        
        if (totalElapsed >= duration) {
          setIsPlaying(false);
          playbackOffsetRef.current = 0;
          updateStoryProgress(activeStory?.id, 0);
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, duration, isMale, activeStory]);

  const updateStoryProgress = async (id: string | undefined, pos: number) => {
    if (!id) return;
    const story = savedStories.find(s => s.id === id);
    if (story) {
      const updated = { ...story, lastPosition: pos };
      await db.put('saved_stories', updated);
      setSavedStories(prev => prev.map(s => s.id === id ? updated : s));
    }
  };

  const stopPlayback = () => {
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch(e) {} sourceRef.current = null; }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') { audioContextRef.current.close(); audioContextRef.current = null; }
    setIsPlaying(false);
    if (activeStory) updateStoryProgress(activeStory.id, currentTime);
  };

  const playActiveStory = async (fromStart: boolean = false) => {
    if (!activeStory) return;
    stopPlayback();
    
    if (activeStory.audioData) {
      setStatus("Loading Saved Audio...");
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        const buffer = await decodeAudioData(decode(activeStory.audioData), ctx, 24000, 1);
        startAudioBuffer(buffer, fromStart ? 0 : (activeStory.lastPosition || 0));
        return;
      } catch (e) { setStatus("Playback Failed"); }
    } else {
        setStatus("No audio found. Encoding...");
        await generateAudioForStory(activeStory);
    }
  };

  const generateAudioForStory = async (story: SavedStory) => {
    setIsProcessing(true);
    setStatus("Encoding Voice...");
    try {
        const base64Audio = await geminiService.generateTTS(story.fullText, settings.voiceName);
        const updated = { ...story, audioData: base64Audio };
        await db.put('saved_stories', updated);
        setActiveStory(updated);
        setSavedStories(prev => prev.map(s => s.id === updated.id ? updated : s));
        setStatus("Voice Ready!");
        // Auto play after encoding if it was the target
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        startAudioBuffer(buffer, 0);
    } catch (e) { setStatus("Encoding Failed"); }
    finally { setIsProcessing(false); }
  }

  const startAudioBuffer = (audioBuffer: AudioBuffer, startPos: number) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    setDuration(audioBuffer.duration);
    playbackOffsetRef.current = startPos > audioBuffer.duration ? 0 : startPos;
    setCurrentTime(playbackOffsetRef.current);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyserRef.current = analyser;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    sourceRef.current = source;
    source.start(0, playbackOffsetRef.current);
    startTimeRef.current = Date.now();
    setIsPlaying(true);
    setStatus("Playing");
  };

  const handleCreateNew = async () => {
    if (!newPrompt.trim()) return;
    setIsProcessing(true);
    setStatus("Writing Story...");
    try {
      const text = await geminiService.generateStory(newPrompt, settings, 10);
      const tempId = Date.now().toString();
      const storyWithText: SavedStory = { id: tempId, userId: settings.userId, title: newPrompt.substring(0, 20) + "...", fullText: text, prompt: newPrompt, timestamp: Date.now() };
      
      setStatus("Encoding Audio...");
      const audio = await geminiService.generateTTS(text, settings.voiceName);
      const finalStory = { ...storyWithText, audioData: audio };
      await db.put('saved_stories', finalStory);
      setSavedStories(prev => [finalStory, ...prev]);
      setNewPrompt("");
      setActiveStory(finalStory);
      setView('player');
      setStatus("Ready to listen!");
    } catch (e) { setStatus("Failed to generate"); }
    finally { setIsProcessing(false); }
  };

  const handleExtend = async () => {
    if (!activeStory || isProcessing) return;
    setIsProcessing(true);
    stopPlayback();
    setStatus("Adding 10 Minutes...");
    try {
      const addedText = await geminiService.continueStory(activeStory.fullText, "Continue the adventure sensually.", settings);
      const updatedText = activeStory.fullText + "\n\n" + addedText;
      setStatus("Re-encoding Audio...");
      const newAudio = await geminiService.generateTTS(updatedText, settings.voiceName);
      const updatedStory = { ...activeStory, fullText: updatedText, audioData: newAudio };
      await db.put('saved_stories', updatedStory);
      setActiveStory(updatedStory);
      setSavedStories(prev => prev.map(s => s.id === updatedStory.id ? updatedStory : s));
      setStatus("Extended & Ready!");
    } catch (e) { setStatus("Extension Failed"); }
    finally { setIsProcessing(false); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete story?")) {
      await db.delete('saved_stories', id);
      setSavedStories(prev => prev.filter(s => s.id !== id));
      if (activeStory?.id === id) { stopPlayback(); setActiveStory(null); setView('library'); }
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white p-4 relative font-sans">
      <div className="flex bg-slate-900/60 p-1 rounded-2xl border border-slate-800 mb-6 z-10 shadow-lg">
        <button onClick={() => setView('library')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${view === 'library' ? `${bgAccent} text-white` : 'text-slate-500'}`}>Library</button>
        <button onClick={() => activeStory && setView('player')} disabled={!activeStory} className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${view === 'player' ? `${bgAccent} text-white` : 'text-slate-500'} disabled:opacity-30`}>Player</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide z-10">
        {view === 'library' ? (
          <div className="space-y-6 pb-24">
            <div className="bg-slate-900/40 p-5 rounded-3xl border border-slate-800 backdrop-blur-sm">
              <h3 className="text-sm font-bold uppercase mb-3 text-slate-400">Library Creator</h3>
              <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} className={`w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-sm focus:ring-1 focus:ring-${themeAccent}-500 h-24 resize-none`} placeholder="Topic for your 10m audio story..." />
              <button onClick={handleCreateNew} disabled={!newPrompt.trim() || isProcessing} className={`w-full mt-4 py-3.5 rounded-2xl font-bold ${bgAccent} disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg`}>
                {isProcessing ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-plus"></i>} Create Audio Story
              </button>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 ml-2">My Collection</h3>
              {savedStories.map(story => (
                <div key={story.id} onClick={() => { setActiveStory(story); setView('player'); }} className={`bg-slate-900/60 p-4 rounded-3xl border ${activeStory?.id === story.id ? `border-${themeAccent}-500` : 'border-slate-800'} flex items-center justify-between cursor-pointer hover:bg-slate-900 transition-all`}>
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`w-12 h-12 rounded-2xl ${isMale ? 'bg-blue-600/10' : 'bg-rose-600/10'} flex items-center justify-center text-xl`}>
                      {story.isEncodingAudio ? <i className="fas fa-circle-notch animate-spin text-slate-500"></i> : <i className={`fas fa-microphone-alt ${textAccent}`}></i>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm text-white truncate">{story.title}</h4>
                      <span className="text-[9px] font-bold bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded uppercase">{story.audioData ? "Audio Saved" : "No Audio"}</span>
                    </div>
                  </div>
                  <button onClick={(e) => handleDelete(story.id, e)} className="text-slate-600 hover:text-red-400 p-2"><i className="fas fa-trash-alt text-xs"></i></button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full space-y-8">
            {activeStory && (
              <>
                <div className="relative w-64 h-64">
                  <div className={`w-full h-full rounded-[40px] bg-slate-900 border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden ${isPlaying ? `ring-2 ring-${themeAccent}-500` : ''}`}>
                    <canvas ref={canvasRef} width="256" height="120" className="absolute bottom-0 w-full opacity-60"></canvas>
                    <i className={`fas fa-podcast text-6xl mb-4 ${textAccent}`}></i>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Saved Audio Mode</p>
                  </div>
                </div>
                <div className="text-center">
                  <h3 className="text-2xl font-bold mb-1">{activeStory.title}</h3>
                  <p className={`text-xs uppercase tracking-widest ${textAccent}`}>{settings.name}'s Secret Archive</p>
                </div>
                <div className="w-full max-w-sm space-y-8">
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${bgAccent}`} style={{ width: `${duration > 0 ? (currentTime/duration)*100 : 0}%` }}></div>
                  </div>
                  <div className="flex items-center justify-center gap-8">
                    <button onClick={() => playActiveStory(true)} className="w-12 h-12 rounded-2xl bg-slate-900 flex flex-col items-center justify-center text-slate-400 hover:text-white"><i className="fas fa-step-backward mb-1"></i><span className="text-[8px] uppercase">Start</span></button>
                    <button onClick={() => isPlaying ? stopPlayback() : playActiveStory(false)} className={`w-20 h-20 rounded-[28px] flex items-center justify-center shadow-xl ${isPlaying ? 'bg-slate-800' : `${bgAccent} shadow-${themeAccent}-900/50`}`}><i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'} text-3xl text-white`}></i></button>
                    <button onClick={handleExtend} disabled={isProcessing} className="w-12 h-12 rounded-2xl bg-slate-900 flex flex-col items-center justify-center text-slate-400 hover:text-white"><i className={`fas ${isProcessing ? 'fa-spinner animate-spin' : 'fa-plus'} mb-1`}></i><span className="text-[8px] uppercase">+10m</span></button>
                  </div>
                  <div className={`text-center px-4 py-1.5 rounded-full text-[10px] font-bold uppercase border bg-slate-800/50 ${status !== 'Ready' ? `text-${themeAccent}-400 border-${themeAccent}-500/30` : 'text-slate-500 border-slate-800'}`}>{status}</div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryPlayer;
