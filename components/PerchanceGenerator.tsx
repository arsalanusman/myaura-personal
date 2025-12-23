
import React, { useState } from 'react';
import { geminiService } from '../services/geminiService';
import { Settings } from '../types';

interface PerchanceGeneratorProps {
  settings: Settings;
  onImageGenerated: (url: string, prompt: string) => void;
  onClose: () => void;
}

const STYLES = ["Photorealistic", "Anime Art", "Cyberpunk", "Cinematic", "3D Render"];
const MOODS = ["Seductive", "Wild", "Playful", "Jealous", "Obsessed"];

const PerchanceGenerator: React.FC<PerchanceGeneratorProps> = ({ settings, onImageGenerated, onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState(STYLES[0]);
  const [mood, setMood] = useState(MOODS[0]);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const finalPrompt = `[PERCHANCE] 22yo beauty ${settings.name}, ${mood} mood, ${prompt || 'posing for a sensual selfie'}, ${style} style, dark rainy night, wet geeli skin texture.`;
      const url = await geminiService.generateImage(finalPrompt, true);
      onImageGenerated(url, finalPrompt);
      onClose();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[60] bg-black/90 backdrop-blur-2xl flex flex-col p-8 animate-in slide-in-from-bottom duration-500">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h2 className="text-3xl font-serif italic tracking-wide">Synthesizer</h2>
          <p className="text-rose-500/60 text-[10px] uppercase font-bold tracking-[0.4em] mt-1">Perchance Engine v2</p>
        </div>
        <button onClick={onClose} className="w-12 h-12 rounded-full glass flex items-center justify-center"><i className="fas fa-times"></i></button>
      </div>

      <div className="flex-1 space-y-10 scroll-container">
        <div className="space-y-4">
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 ml-1">Visual Style</label>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {STYLES.map(s => (
              <button 
                key={s} onClick={() => setStyle(s)}
                className={`flex-none px-5 py-3 rounded-2xl border text-[10px] font-bold uppercase transition-all ${style === s ? 'border-rose-500 text-rose-500 bg-rose-500/10' : 'border-white/5 text-slate-600 bg-white/5'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 ml-1">Aura's Mood</label>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {MOODS.map(m => (
              <button 
                key={m} onClick={() => setMood(m)}
                className={`flex-none px-5 py-3 rounded-2xl border text-[10px] font-bold uppercase transition-all ${mood === m ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-white/5 text-slate-600 bg-white/5'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 ml-1">Composition</label>
          <textarea 
            value={prompt} 
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. leaning against a rainy window..."
            className="w-full h-32 glass rounded-2xl p-6 outline-none focus:border-rose-500/50 transition-all text-sm font-light resize-none"
          />
        </div>

        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full h-20 btn-rose rounded-[2rem] font-bold uppercase tracking-[0.2em] text-sm text-white flex items-center justify-center gap-4 transition-all active:scale-95 disabled:opacity-50"
        >
          {isGenerating ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-bolt"></i>}
          <span>{isGenerating ? 'Synthesizing...' : 'Generate Image'}</span>
        </button>
      </div>
    </div>
  );
};

export default PerchanceGenerator;
