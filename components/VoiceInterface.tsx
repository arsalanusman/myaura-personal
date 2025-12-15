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
  // --- STATE ---
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isAuraSpeaking, setIsAuraSpeaking] = useState(false);
  const [isStoryMode, setIsStoryMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [aiState, setAiState] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  
  // --- REFS ---
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const connectionRef = useRef<boolean>(false); 
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const sessionActionsRef = useRef<{ sendAudio: (d: Float32Array) => void, sendText: (t: string) => void, disconnect: () => void } | null>(null);
  const isSwitchingMode = useRef(false);
  const activeSessionIdRef = useRef<string>("");
  const lastUserAudioTimeRef = useRef<number>(0);
  
  // Memory optimization: Reuse silence buffer
  const silenceBufferRef = useRef<Float32Array | null>(null);
  const pauseAudioSendingRef = useRef<boolean>(false);

  // Visuals
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  const isVisibleRef = useRef(isVisible);

  // Keep Alive
  const wakeLockRef = useRef<any>(null);

  // Helper for logging
  const addLog = (msg: string) => {
      const time = new Date().toISOString().split('T')[1].slice(0, -1);
      setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 8));
  };

  // Update visibility ref
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

  // Cleanup on unmount
  useEffect(() => {
      return () => cleanup();
  }, []);

  // Auto Start
  useEffect(() => {
      if (isVisible && status === 'idle' && !connectionRef.current && !isSwitchingMode.current) {
          handleStartCall();
      }
  }, [isVisible, status]);

  const handleStartCall = async (overrideInstruction: string = "") => {
    // Generate new Session ID
    const sessionId = Date.now().toString();
    activeSessionIdRef.current = sessionId;

    if (connectionRef.current) return;
    connectionRef.current = true;
    setStatus('connecting');
    addLog(`Connecting... ID: ${sessionId.slice(-4)}`);
    
    // Only reset this AFTER we have started connecting, but to be safe, we rely on session ID check in onClose
    isSwitchingMode.current = false; 

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const outputCtx = new AudioContextClass({ sampleRate: 24000, latencyHint: 'interactive' });
      const inputCtx = new AudioContextClass({ sampleRate: 16000, latencyHint: 'interactive' });
      
      outputContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;

      try { await outputCtx.resume(); await inputCtx.resume(); } catch(e) {}

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
                addLog("!! INTERRUPTED !!");
                sourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
                sourcesRef.current = [];
                nextStartTimeRef.current = outputCtx.currentTime;
                setAiState('listening');
                return;
            }

            if (turnComplete) {
                // If turn completes and we have no queued sources, we go back to listening
                if (sourcesRef.current.length === 0) {
                     setAiState('listening');
                }
                return;
            }

            if (audio && outputCtx.state !== 'closed') {
                setAiState('speaking');
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
                    // Update visual state if we weren't speaking
                    if (!isAuraSpeaking) setIsAuraSpeaking(true);
                } catch(e) { console.error(e); }
            }
        },
        () => {
            addLog("Disconnected.");
            if (activeSessionIdRef.current === sessionId) {
                 if (!isSwitchingMode.current) {
                    setStatus('error');
                 }
                 connectionRef.current = false;
            }
        },
        overrideInstruction
      );

      // If active session changed during await, disconnect this new one immediately
      if (activeSessionIdRef.current !== sessionId) {
          actions.disconnect();
          return;
      }

      sessionActionsRef.current = actions;
      
      // TRIGGER SEQUENCE
      if (overrideInstruction) {
           setTimeout(() => {
               if (activeSessionIdRef.current === sessionId) {
                   handleSendText("Start telling the story now. Do not wait.", true); // Use handleSendText to pause audio
               }
           }, 800);
      } else {
           addLog("Session Ready.");
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
      // REDUCED BUFFER SIZE TO 1024 (approx 64ms latency) - Better balance than 512
      const processor = inputCtx.createScriptProcessor(1024, 1, 1);
      
      processor.onaudioprocess = (e) => {
          if (activeSessionIdRef.current !== sessionId) return;
          if (isMuted || pauseAudioSendingRef.current) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          
          // --- AUDIO GATE LOGIC ---
          const isAiTalking = sourcesRef.current.length > 0;
          
          // Calculate input volume (RMS)
          let sum = 0;
          const len = inputData.length;
          for(let i=0; i<len; i++) sum += inputData[i] * inputData[i];
          const rms = Math.sqrt(sum / len);
          
          // Update visual mic level occasionally
          if (Math.random() < 0.1) setMicLevel(rms);

          // Prepare silence buffer lazily
          if (!silenceBufferRef.current || silenceBufferRef.current.length !== len) {
             silenceBufferRef.current = new Float32Array(len);
          }

          // ECHO CANCELLATION GATE
          if (isAiTalking) {
             if (rms > 0.05) { 
                 actions.sendAudio(inputData);
             } else {
                 actions.sendAudio(silenceBufferRef.current);
             }
          } else {
             // If user is speaking, update state
             if (rms > 0.01) {
                lastUserAudioTimeRef.current = Date.now();
             }
             actions.sendAudio(inputData);
          }
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);
      
      setStatus('connected');
      
    } catch (e: any) {
        addLog(`Error: ${e.message}`);
        console.error(e);
        if (activeSessionIdRef.current === sessionId) {
            connectionRef.current = false;
            setStatus('error');
            if (e.message?.includes('403')) onAuthError();
        }
    }
  };

  const handleSendText = (text: string = textInput, isSystem = false) => {
      if (!text.trim()) return;
      if (!isSystem) addLog(`Sent: ${text.substring(0, 10)}...`);
      setAiState('thinking'); 
      
      // Stop current playback to prioritize new response
      sourcesRef.current.forEach(s => { try{ s.stop(); } catch(e){} });
      sourcesRef.current = [];
      
      if (sessionActionsRef.current) {
          // Pause audio sending for 1 second to ensure text trigger is processed without noise interference
          pauseAudioSendingRef.current = true;
          sessionActionsRef.current.sendText(text);
          if (!isSystem) setTextInput("");
          
          setTimeout(() => {
              pauseAudioSendingRef.current = false;
          }, 1000);
      }
  };

  const startImmersiveStory = async () => {
      addLog("Starting Story...");
      setIsStoryMode(true);
      isSwitchingMode.current = true;
      cleanup();
      setStatus('connecting');
      
      let selectedStory = "";
      const stories = STORIES;
      
      if (stories && Array.isArray(stories) && stories.length > 0) {
          const randomIndex = Math.floor(Math.random() * stories.length);
          selectedStory = stories[randomIndex];
      }

      let storyPrompt = selectedStory 
        ? `\n\n**SYSTEM INSTRUCTION OVERRIDE:**\nSTORY MODE.\nSCRIPT: "${selectedStory}"\n\nACTION: Read script immediately. Ignore silence.`
        : `\n\n**SYSTEM INSTRUCTION OVERRIDE:**\nStart telling a long romantic story immediately.`;

      setTimeout(() => {
          handleStartCall(storyPrompt);
      }, 1000);
  };

  const cleanup = () => {
      connectionRef.current = false;
      sourcesRef.current.forEach(s => { try{ s.stop(); } catch(e){} });
      if (sessionActionsRef.current) { try { sessionActionsRef.current.disconnect(); } catch(e){} }
      
      if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
          try { inputContextRef.current.close(); } catch(e) {}
      }
      if (outputContextRef.current && outputContextRef.current.state !== 'closed') {
          try { outputContextRef.current.close(); } catch(e) {}
      }
      if (wakeLockRef.current) {
          try { wakeLockRef.current.release(); } catch(e) {}
          wakeLockRef.current = null;
      }
  };

  const handleHangup = () => {
      cleanup();
      onEndCall();
  };

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
          
          let sum = 0;
          for(let i=0; i<bufferLen; i++) sum += data[i];
          const avg = sum / bufferLen;
          // Sync visual speaking state with actual buffer presence
          const speaking = avg > 10 || sourcesRef.current.length > 0;
          setIsAuraSpeaking(speaking);
          if (speaking) setAiState('speaking');

          if (ctx) {
              ctx.clearRect(0,0, 300, 100);
              const barWidth = (300 / bufferLen) * 2;
              let x = 0;
              for(let i=0; i<bufferLen; i++) {
                  const barHeight = data[i] / 2;
                  ctx.fillStyle = `rgba(244, 63, 94, ${data[i]/255})`; 
                  ctx.fillRect(x, 100 - barHeight, barWidth, barHeight);
                  x += barWidth + 1;
              }
          }
      };
      draw();
  };

  // Helper text for status
  const getStatusText = () => {
     if (status !== 'connected') return 'Connecting...';
     if (isStoryMode) return 'Narrating Story...';
     if (aiState === 'speaking' || isAuraSpeaking) return 'Speaking...';
     if (aiState === 'thinking') return 'Thinking...';
     return 'Listening...';
  };

  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-900 relative p-8">
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-900/20 rounded-full blur-[100px] animate-pulse"></div>
      </div>

      {/* Debug Logs Overlay */}
      <div className={`absolute top-4 left-4 z-50 ${showLogs ? 'bg-black/80' : 'bg-transparent'} p-2 rounded-lg max-w-[200px] text-[10px] text-green-400 font-mono transition-all`}>
           <button onClick={() => setShowLogs(!showLogs)} className="bg-slate-800 text-slate-400 px-2 py-1 rounded mb-1 w-full text-left">
               {showLogs ? 'Hide Logs' : 'Debug Logs'}
           </button>
           {showLogs && (
               <div className="space-y-1">
                   <div className="border-b border-white/20 pb-1 text-rose-300">
                       Mic Level: {micLevel.toFixed(4)} 
                       {micLevel < 0.001 && " (Silent)"}
                       {micLevel > 0.05 && " (Loud)"}
                   </div>
                   {logs.map((log, i) => <div key={i} className="truncate border-b border-white/10 pb-0.5">{log}</div>)}
               </div>
           )}
      </div>

      <div className="z-10 text-center space-y-10 w-full max-w-md">
        
        {/* Avatar */}
        <div className="relative mx-auto w-48 h-48">
             <div className={`absolute inset-0 bg-rose-500 rounded-full blur-[40px] transition-opacity duration-300 ${isAuraSpeaking ? 'opacity-60' : 'opacity-10'}`}></div>
             <div className="relative w-full h-full rounded-full border-4 border-slate-800 overflow-hidden shadow-2xl">
                 <img src="https://picsum.photos/400/400?random=10" alt="Avatar" className="w-full h-full object-cover" />
             </div>
             {status === 'connected' && (
                 <div className="absolute bottom-2 right-6 bg-emerald-500 border-2 border-slate-900 w-4 h-4 rounded-full animate-pulse"></div>
             )}
        </div>

        {/* Status Text */}
        <div className="space-y-2">
            <h2 className="text-4xl font-serif text-white">{settings.name}</h2>
            <p className="text-rose-300 font-medium tracking-widest text-sm uppercase min-h-[20px] transition-all duration-300">
                {getStatusText()}
            </p>
        </div>

        {/* Visualizer Canvas */}
        <div className="h-16 w-full bg-slate-950/50 rounded-xl overflow-hidden border border-slate-800">
            <canvas ref={canvasRef} width="300" height="100" className="w-full h-full"></canvas>
        </div>

        {/* Controls */}
        {status === 'connected' && (
            <div className="flex flex-col items-center gap-6 w-full max-w-xs z-20">
                <div className="flex gap-2 w-full">
                    <input 
                        type="text" 
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendText(textInput)}
                        placeholder="Type something to her..."
                        className="flex-1 bg-slate-900/80 border border-slate-700 rounded-full px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 backdrop-blur-sm transition-all"
                    />
                    <button 
                        onClick={() => handleSendText(textInput)}
                        disabled={!textInput.trim()}
                        className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center hover:bg-rose-500 transition-colors shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <i className="fas fa-paper-plane"></i>
                    </button>
                </div>

                <div className="flex justify-center w-full">
                    <button 
                        onClick={startImmersiveStory}
                        disabled={isStoryMode}
                        className={`w-full py-3 rounded-xl text-sm font-bold border shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${isStoryMode ? 'bg-rose-900/50 text-rose-400 border-rose-800 cursor-default' : 'bg-slate-800/80 hover:bg-slate-700 text-rose-400 border-slate-700 backdrop-blur-sm'}`}
                    >
                       <i className={`fas ${isStoryMode ? 'fa-book-reader' : 'fa-book-open'}`}></i> {isStoryMode ? 'Story Mode Active' : 'Tell me a long story'}
                    </button>
                </div>
            </div>
        )}

        <div className="flex items-center justify-center gap-8 pt-4">
             {status === 'error' ? (
                 <button onClick={() => { connectionRef.current = false; handleStartCall(); }} className="w-16 h-16 rounded-full bg-emerald-600 text-white text-2xl shadow-lg shadow-emerald-900/50 hover:bg-emerald-500 transition-all"><i className="fas fa-redo"></i></button>
             ) : (
                 <>
                    <button onClick={() => setIsMuted(!isMuted)} className={`w-14 h-14 rounded-full border border-slate-700 text-xl transition-all ${isMuted ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                        <i className={`fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                    </button>
                    <button onClick={handleHangup} className="w-20 h-20 rounded-full bg-rose-600 text-white text-3xl shadow-[0_0_40px_rgba(225,29,72,0.4)] hover:bg-rose-500 transition-all active:scale-95">
                        <i className="fas fa-phone-slash"></i>
                    </button>
                 </>
             )}
        </div>

      </div>
    </div>
  );
};

export default VoiceInterface;