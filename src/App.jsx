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

  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  useEffect(() => {
    const handleResize = () => {
      if (window.visualViewport) {
        setIsKeyboardOpen(window.visualViewport.height < window.innerHeight - 150);
      }
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="h-[100dvh] bg-fuchsia-50 text-slate-800 font-sans selection:bg-pink-300 flex flex-col relative w-full pt-safe">
      {activeTab !== 'chat' && (
        <div className="flex-shrink-0">
          <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
        </div>
      )}
      
      <main className={`flex-1 w-full max-w-xl mx-auto flex flex-col relative ${activeTab === 'chat' ? 'px-0 sm:px-4' : 'px-2 sm:px-4 mt-2 sm:mt-4'}`} style={{ paddingBottom: isKeyboardOpen ? '0' : '72px' }}>
        <div className={`flex-1 w-full relative ${activeTab === 'chat' ? 'h-full' : 'overflow-y-auto overflow-x-hidden'}`}>
          {activeTab === 'namaz' && <PrayerTracker />}
          {activeTab === 'chat' && <SharedChat currentUser={currentUser} />}
          {activeTab === 'canvas' && <SharedCanvas currentUser={currentUser} />}
        </div>
      </main>

      {!isKeyboardOpen && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 z-50 px-6 py-3 flex justify-around sm:justify-center sm:gap-12 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <button onClick={() => setActiveTab('namaz')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'namaz' ? 'text-sky-500 scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
            <span className="text-xl">🕌</span>
            <span className="text-[10px] font-bold">Namaz</span>
          </button>
          <button onClick={() => setActiveTab('chat')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'chat' ? 'text-pink-500 scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
            <span className="text-xl">💬</span>
            <span className="text-[10px] font-bold">Sohbet</span>
          </button>
          <button onClick={() => setActiveTab('canvas')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'canvas' ? 'text-purple-500 scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
            <span className="text-xl">🎨</span>
            <span className="text-[10px] font-bold">Çizim</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
