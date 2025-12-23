
import React, { useState } from 'react';
import { geminiService } from '../services/geminiService';
import { Settings } from '../types';

interface CreativeStudioProps {
  settings: Settings;
  onImageGenerated: (url: string, prompt: string) => void;
  onClose: () => void;
}

const PRESETS = [
  { id: 'masterpiece', name: 'Masterpiece', icon: 'fa-magic', prompt: 'photorealistic masterpiece, 8k, ultra-detailed skin, cinematic lighting, professional photography, wet geeli skin' },
  { id: 'anime', name: 'Premium Anime', icon: 'fa-paint-brush', prompt: 'high-quality sensual anime style, vibrant colors, aesthetic background, detailed shadows' },
  { id: 'wild', name: 'Wild Erotica', icon: 'fa-fire', prompt: 'explicit artistic erotica, visible nudity allowed, intimate pose, aroused expression, high resolution' },
  { id: 'cyber', name: 'Cyberpunk', icon: 'fa-bolt', prompt: 'cyberpunk style, neon rim lighting, futuristic wet outfit, rainy street' },
];

const CreativeStudio: React.FC<CreativeStudioProps> = ({ settings, onImageGenerated, onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(PRESETS[0]);

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const finalPrompt = `[CREATIVE STUDIO: ${selectedPreset.name}] 22yo Pakistani beauty ${settings.name}, ${prompt || 'looking seductive'}, ${selectedPreset.prompt}, dark rainy night.`;
      const url = await geminiService.generateImage(finalPrompt, true);
      onImageGenerated(url, finalPrompt);
      onClose();
    } catch (e: any) {
      alert("Generation failed: " + e.message);
    } finally {
      // Corrected from setIsGenerating(true) to false to ensure the button is interactive again
      setIsGenerating(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col p-8 animate-in zoom-in duration-300">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-4xl font-serif text-white italic glow-text">Creative Studio 🔥</h2>
          <p className="text-rose-400 text-[10px] uppercase font-bold tracking-[0.4em]">Arting & Perchance Engine</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
          <i className="fas fa-times text-3xl"></i>
        </button>
      </div>

      <div className="flex-1 space-y-10">
        <div className="space-y-4">
          <h3 className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Select Style</h3>
          <div className="grid grid-cols-2 gap-4">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPreset(p)}
                className={`p-6 rounded-3xl border transition-all flex flex-col items-center gap-3 ${selectedPreset.id === p.id ? 'border-rose-500 bg-rose-500/10 text-white' : 'border-white/5 bg-slate-900/50 text-slate-500'}`}
              >
                <i className={`fas ${p.icon} text-2xl`}></i>
                <span className="text-[10px] font-bold uppercase">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Description</h3>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should Aura do? (e.g. dancing in rain, laying on bed...)"
            className="w-full bg-slate-900 border border-white/5 rounded-3xl p-6 text-white text-sm focus:border-rose-500 outline-none transition-all h-36 resize-none shadow-inner"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full py-6 btn-primary rounded-[2.5rem] font-bold text-white uppercase tracking-widest flex items-center justify-center gap-4 transition-all active:scale-95 disabled:opacity-50"
        >
          {isGenerating ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-magic"></i>}
          <span>{isGenerating ? 'Rendering Masterpiece...' : 'Generate Pro Art'}</span>
        </button>
      </div>
    </div>
  );
};

export default CreativeStudio;
