
import React, { useEffect, useRef, useState } from 'react';
import { geminiService, decodeAudioData, decode } from '../services/geminiService';
import { Settings } from '../types';
import { STORIES } from '../services/storyData';

interface VoiceInterfaceProps {
  settings: Settings;
  isVisible: boolean;
  onEndCall: () => void;
  onAuthError: () => void;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ settings, isVisible, onEndCall, onAuthError }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isAuraSpeaking, setIsAuraSpeaking] = useState(false);
  const [isStoryMode, setIsStoryMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [aiState, setAiState] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  const [errorMessage, setErrorMessage] = useState("");
  
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const connectionRef = useRef<boolean>(false); 
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const sessionActionsRef = useRef<{ sendAudio: (d: Float32Array) => void, sendText: (t: string) => void, disconnect: () => void } | null>(null);
  const isSwitchingMode = useRef(false);
  const activeSessionIdRef = useRef<string>("");
  const pauseAudioSendingRef = useRef<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  const isVisibleRef = useRef(isVisible);
  const wakeLockRef = useRef<any>(null);
  const thinkingTimeoutRef = useRef<number | null>(null);

  const isMale = settings.aiGender === 'male';
  const avatarUrl = isMale 
      ? "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400"
      : "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400";
  const glowColor = isMale ? 'bg-blue-500' : 'bg-rose-500';
  const glowBg = isMale ? 'bg-blue-900/20' : 'bg-rose-900/20';
  const buttonPrimary = isMale ? 'bg-blue-600' : 'bg-rose-600';
  const textAccent = isMale ? 'text-blue-300' : 'text-rose-300';
  const visualizerFill = isMale ? "rgba(59, 130, 246, " : "rgba(244, 63, 94, ";

  const addLog = (msg: string) => {
      const time = new Date().toISOString().split('T')[1].slice(0, -1);
      setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 8));
  };

  useEffect(() => {
      isVisibleRef.current = isVisible;
      if (isVisible && status === 'connected') {
          drawVisualizer();
          if (outputContextRef.current?.state === 'suspended') outputContextRef.current.resume();
          if (inputContextRef.current?.state === 'suspended') inputContextRef.current.resume();
      } else {
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (isVisible && 'wakeLock' in navigator) {
          (navigator as any).wakeLock.request('screen').then((l: any) => wakeLockRef.current = l).catch(() => {});
      }
  }, [isVisible, status]);

  useEffect(() => {
      return () => cleanup();
  }, []);

  useEffect(() => {
      if (isVisible && status === 'idle' && !connectionRef.current && !isSwitchingMode.current) {
          handleStartCall();
      }
  }, [isVisible, status]);

  const clearThinkingTimeout = () => {
      if (thinkingTimeoutRef.current) {
          window.clearTimeout(thinkingTimeoutRef.current);
          thinkingTimeoutRef.current = null;
      }
  };

  const handleStartCall = async (overrideInstruction: string = "") => {
    const sessionId = Date.now().toString();
    activeSessionIdRef.current = sessionId;
    setErrorMessage("");

    if (connectionRef.current) return;
    connectionRef.current = true;
    setStatus('connecting');
    addLog(`Connecting...`);
    isSwitchingMode.current = false; 

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const outputCtx = new AudioContextClass({ sampleRate: 24000, latencyHint: 'interactive' });
      const inputCtx = new AudioContextClass({ sampleRate: 16000, latencyHint: 'interactive' });
      
      outputContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;

      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      const gain = outputCtx.createGain();
      gain.connect(analyser);
      analyser.connect(outputCtx.destination);

      const actions = await geminiService.connectLiveSession(
        settings,
        async ({ audio, interrupted, turnComplete }) => {
            if (activeSessionIdRef.current !== sessionId) return;

            if (interrupted) {
                clearThinkingTimeout();
                sourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
                sourcesRef.current = [];
                nextStartTimeRef.current = outputCtx.currentTime;
                setAiState('listening');
                setIsAuraSpeaking(false);
                return;
            }

            if (turnComplete) {
                clearThinkingTimeout();
                if (sourcesRef.current.length === 0) {
                  setAiState('listening');
                  setIsAuraSpeaking(false);
                }
                return;
            }

            if (audio && outputCtx.state !== 'closed') {
                clearThinkingTimeout();
                setAiState('speaking');
                setIsAuraSpeaking(true);
                const currentTime = outputCtx.currentTime;
                if (nextStartTimeRef.current < currentTime) nextStartTimeRef.current = currentTime;

                try {
                    const buffer = await decodeAudioData(decode(audio), outputCtx, 24000, 1);
                    const source = outputCtx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(gain);
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += buffer.duration;
                    
                    source.onended = () => {
                        sourcesRef.current = sourcesRef.current.filter(s => s !== source);
                        if (sourcesRef.current.length === 0) {
                            setAiState('listening');
                            setIsAuraSpeaking(false);
                        }
                    };
                    sourcesRef.current.push(source);
                } catch(e) { console.error(e); }
            }
        },
        () => {
            if (activeSessionIdRef.current === sessionId) {
                 clearThinkingTimeout();
                 if (!isSwitchingMode.current) setStatus('error');
                 connectionRef.current = false;
            }
        },
        overrideInstruction
      );

      sessionActionsRef.current = actions;

      if (activeSessionIdRef.current !== sessionId) {
          actions.disconnect();
          return;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true, 
          channelCount: 1, 
          sampleRate: 16000 
        } 
      });
      
      const source = inputCtx.createMediaStreamSource(stream);
      // Increased buffer size to 2048 to reduce call frequency and API rate limit pressure.
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      
      processor.onaudioprocess = (e) => {
          if (activeSessionIdRef.current !== sessionId) return;
          if (isMuted || pauseAudioSendingRef.current || !sessionActionsRef.current) return;
          const inputData = e.inputBuffer.getChannelData(0);
          sessionActionsRef.current.sendAudio(inputData);
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);
      setStatus('connected');
      
    } catch (e: any) {
        addLog(`Error: ${e.message}`);
        setErrorMessage(e.message || "Connection failed");
        if (activeSessionIdRef.current === sessionId) {
            connectionRef.current = false;
            setStatus('error');
            if (e.message?.includes('403')) onAuthError();
        }
    }
  };

  const handleSendText = (text: string = textInput) => {
      if (!text.trim()) return;
      
      clearThinkingTimeout();
      setAiState('thinking'); 
      pauseAudioSendingRef.current = true;
      
      thinkingTimeoutRef.current = window.setTimeout(() => {
          setAiState('listening');
          pauseAudioSendingRef.current = false;
          addLog("Timed out.");
      }, 15000);

      sourcesRef.current.forEach(s => { try{ s.stop(); } catch(e){} });
      sourcesRef.current = [];
      
      if (sessionActionsRef.current) {
          sessionActionsRef.current.sendText(text);
          setTextInput("");
      }

      setTimeout(() => { pauseAudioSendingRef.current = false; }, 3000);
  };

  const cleanup = () => {
      clearThinkingTimeout();
      connectionRef.current = false;
      sourcesRef.current.forEach(s => { try{ s.stop(); } catch(e){} });
      if (sessionActionsRef.current) { try { sessionActionsRef.current.disconnect(); } catch(e){} }
      if (inputContextRef.current && inputContextRef.current.state !== 'closed') try { inputContextRef.current.close(); } catch(e) {}
      if (outputContextRef.current && outputContextRef.current.state !== 'closed') try { outputContextRef.current.close(); } catch(e) {}
      if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch(e) {} wakeLockRef.current = null; }
  };

  const handleHangup = () => { cleanup(); onEndCall(); };

  const drawVisualizer = () => {
      if (!canvasRef.current || !analyserRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const analyser = analyserRef.current;
      const bufferLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufferLen);

      const draw = () => {
          if (!isVisibleRef.current) return;
          animationFrameRef.current = requestAnimationFrame(draw);
          analyser.getByteFrequencyData(data);
          if (ctx) {
              ctx.clearRect(0,0, 300, 100);
              const barWidth = (300 / bufferLen) * 2;
              let x = 0;
              for(let i=0; i<bufferLen; i++) {
                  const barHeight = data[i] / 2;
                  ctx.fillStyle = `${visualizerFill}${data[i]/255})`; 
                  ctx.fillRect(x, 100 - barHeight, barWidth, barHeight);
                  x += barWidth + 1;
              }
          }
      };
      draw();
  };

  const getStatusText = () => {
     if (status === 'error') return errorMessage || 'Connection Failed';
     if (status !== 'connected') return 'Connecting...';
     if (isStoryMode) return 'Narrating...';
     if (aiState === 'speaking' || isAuraSpeaking) return 'Speaking...';
     if (aiState === 'thinking') return 'Thinking...';
     return 'Listening...';
  };

  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-900 relative p-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 ${glowBg} rounded-full blur-[100px] animate-pulse`}></div>
      </div>

      <div className="z-10 text-center space-y-10 w-full max-w-md">
        <div className="relative mx-auto w-48 h-48">
             <div className={`absolute inset-0 ${glowColor} rounded-full blur-[40px] transition-opacity duration-300 ${isAuraSpeaking ? 'opacity-60' : 'opacity-10'}`}></div>
             <div className="relative w-full h-full rounded-full border-4 border-slate-800 overflow-hidden shadow-2xl">
                 <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
             </div>
        </div>

        <div className="space-y-2">
            <h2 className="text-4xl font-serif text-white">{settings.name}</h2>
            <p className={`${textAccent} font-medium tracking-widest text-sm uppercase min-h-[20px] transition-all duration-300`}>
                {getStatusText()}
            </p>
        </div>

        <div className="h-16 w-full bg-slate-950/50 rounded-xl overflow-hidden border border-slate-800">
            <canvas ref={canvasRef} width="300" height="100" className="w-full h-full"></canvas>
        </div>

        {status === 'connected' && (
            <div className="flex flex-col items-center gap-6 w-full max-w-xs z-20">
                <div className="flex gap-2 w-full">
                    <input 
                        type="text" 
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                        placeholder={`Talk to ${settings.name}...`}
                        className="flex-1 bg-slate-900/80 border border-slate-700 rounded-full px-4 py-3 text-sm text-white outline-none focus:border-rose-500 transition-all"
                    />
                </div>
            </div>
        )}

        <div className="flex items-center justify-center gap-8 pt-4">
             <button onClick={() => setIsMuted(!isMuted)} className={`w-14 h-14 rounded-full border border-slate-700 text-xl transition-all ${isMuted ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                 <i className={`fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
             </button>
             <button onClick={handleHangup} className={`w-20 h-20 rounded-full ${buttonPrimary} text-white text-3xl shadow-lg hover:opacity-90 transition-all active:scale-95`}>
                 <i className="fas fa-phone-slash"></i>
             </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceInterface;
