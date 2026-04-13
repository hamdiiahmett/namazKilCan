import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import PrayerTracker from './components/PrayerTracker';
import SharedChat from './components/SharedChat';
import SharedCanvas from './components/SharedCanvas';

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || 'zenep';
  });
  const [activeTab, setActiveTab] = useState('chat');
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [vph, setVph] = useState(
    () => window.visualViewport?.height ?? window.innerHeight
  );

  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  useEffect(() => {
    const handleResize = () => {
      if (window.visualViewport) {
        const h = window.visualViewport.height;
        setVph(h);
        setIsKeyboardOpen(h < window.innerHeight - 150);
      }
    };
    if (window.visualViewport) {
      // Set initial
      handleResize();
      window.visualViewport.addEventListener('resize', handleResize);
    }
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, []);

  const TAB_NAV_H = 72; // px - bottom nav height

  return (
    <div style={{ height: vph }} className="bg-fuchsia-50 text-slate-800 font-sans selection:bg-pink-300 flex flex-col overflow-hidden w-full relative">
      {/* Header — always visible */}
      <div className="flex-shrink-0 z-30">
        <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
      </div>

      {/* Main content — grows to fill remaining space */}
      <main className="flex-1 min-h-0 w-full max-w-xl mx-auto flex flex-col relative"
        style={{ paddingBottom: isKeyboardOpen ? '0' : `${TAB_NAV_H}px` }}>

        <div className={`flex-1 min-h-0 w-full ${activeTab !== 'chat' ? 'overflow-y-auto overflow-x-hidden px-2 sm:px-4 pt-3 pb-2' : ''}`}>
          {activeTab === 'namaz' && <PrayerTracker />}
          {activeTab === 'chat' && <SharedChat currentUser={currentUser} />}
          {activeTab === 'canvas' && <div className="px-2 sm:px-4"><SharedCanvas currentUser={currentUser} /></div>}
        </div>
      </main>

      {/* Bottom Tab Bar */}
      {!isKeyboardOpen && (
        <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200/80 z-50 flex justify-around items-center px-6 py-2"
          style={{ paddingBottom: `calc(8px + env(safe-area-inset-bottom))`, height: `${TAB_NAV_H}px` }}>
          <button onClick={() => setActiveTab('namaz')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'namaz' ? 'text-sky-500' : 'text-slate-400'}`}>
            <span className={`text-2xl transition-transform duration-200 ${activeTab === 'namaz' ? 'scale-110' : ''}`}>🕌</span>
            <span className="text-[10px] font-bold tracking-wide">Namaz</span>
          </button>
          <button onClick={() => setActiveTab('chat')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'chat' ? 'text-pink-500' : 'text-slate-400'}`}>
            <span className={`text-2xl transition-transform duration-200 ${activeTab === 'chat' ? 'scale-110' : ''}`}>💬</span>
            <span className="text-[10px] font-bold tracking-wide">Sohbet</span>
          </button>
          <button onClick={() => setActiveTab('canvas')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'canvas' ? 'text-purple-500' : 'text-slate-400'}`}>
            <span className={`text-2xl transition-transform duration-200 ${activeTab === 'canvas' ? 'scale-110' : ''}`}>🎨</span>
            <span className="text-[10px] font-bold tracking-wide">Çizim</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
