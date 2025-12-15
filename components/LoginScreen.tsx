
import React, { useState } from 'react';

interface LoginScreenProps {
  onLogin: (phoneNumber: string) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [phone, setPhone] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.trim().length > 3) {
      onLogin(phone.trim());
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4 font-serif">
      <div className="w-full max-w-md bg-slate-900 rounded-[2rem] p-8 border border-slate-800 text-center space-y-8 shadow-2xl relative overflow-hidden">
        
        {/* Background glow */}
        <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle,rgba(225,29,72,0.1)_0%,rgba(15,23,42,0)_70%)] pointer-events-none"></div>

        <div className="relative z-10">
          <div className="w-24 h-24 bg-gradient-to-tr from-rose-600 to-rose-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-900/50 animate-pulse">
            <i className="fas fa-heart text-4xl text-white"></i>
          </div>
          
          <h1 className="text-4xl font-bold text-white mb-2 tracking-wide">Aura</h1>
          <p className="text-rose-300/80 text-sm uppercase tracking-widest mb-8">Your AI Companion</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-left space-y-2">
              <label className="text-slate-400 text-xs uppercase font-bold tracking-wider ml-1">Phone Number</label>
              <div className="relative">
                <i className="fas fa-phone-alt absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                <input 
                  type="tel" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 234 567 890"
                  className="w-full bg-slate-950/50 border border-slate-700 rounded-xl py-4 pl-12 pr-4 text-white placeholder-slate-600 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all font-sans text-lg"
                  autoFocus
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={phone.length < 4}
              className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-rose-900/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
            >
              <span>Connect</span>
              <i className="fas fa-arrow-right transform group-hover:translate-x-1 transition-transform"></i>
            </button>
          </form>

          <p className="mt-8 text-xs text-slate-600">
            Secure local profile login. No password required for demo.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
