import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import PrayerTracker from './components/PrayerTracker';
import SharedChat from './components/SharedChat';
import SharedCanvas from './components/SharedCanvas';
import Home from './components/Home';

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || 'zenep';
  });
  const [activeTab, setActiveTab] = useState('home');
  const [vph, setVph] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [kbOffset, setKbOffset] = useState(0);

  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  useEffect(() => {
    const handleResize = () => {
      const vv = window.visualViewport;
      if (vv) {
        const height = vv.height;
        setVph(height);
        
        const kh = window.innerHeight - height;
        const isOpen = kh > 150;
        
        // klavye yüksekliğine göre offset belirle
        setKbOffset(isOpen ? kh : 0);

        // Body Overflow Kısıtlaması (bouncing engellemek için)
        if (isOpen) {
          document.documentElement.style.position = 'fixed';
          document.documentElement.style.width = '100%';
          document.documentElement.style.height = '100%';
          document.documentElement.style.overflow = 'hidden';
          document.body.style.position = 'fixed';
          document.body.style.width = '100%';
          document.body.style.height = '100%';
          document.body.style.overflow = 'hidden';
        } else {
          document.documentElement.style.position = '';
          document.documentElement.style.width = '';
          document.documentElement.style.height = '';
          document.documentElement.style.overflow = '';
          document.body.style.position = '';
          document.body.style.width = '';
          document.body.style.height = '';
          document.body.style.overflow = '';
        }
      }
    };

    if (window.visualViewport) {
      handleResize();
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }
    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
    };
  }, []);

  return (
    <div style={{ height: window.innerHeight }} className="bg-fuchsia-50 text-slate-800 font-sans selection:bg-pink-300 flex flex-col overflow-hidden w-full relative">
      {/* Header */}
      <div className="flex-shrink-0 z-30">
        <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
      </div>

      {/* Main content - Dynamic padding at the top for messages optionally handled by chat */}
      <main className="flex-1 min-h-0 w-full max-w-[500px] mx-auto flex flex-col relative bg-fuchsia-50 pb-[140px]">
        <div className={`flex-1 min-h-0 w-full flex flex-col ${activeTab !== 'chat' ? 'overflow-y-auto overflow-x-hidden pt-3' : ''}`}>
          {activeTab === 'home' && <Home />}
          {activeTab === 'namaz' && <PrayerTracker />}
          {activeTab === 'chat' && <SharedChat currentUser={currentUser} />}
          {activeTab === 'canvas' && <div className="px-2 sm:px-4"><SharedCanvas currentUser={currentUser} /></div>}
        </div>
      </main>

      {/* Ortak Kapsayıcı (Alt Menü ve Mesaj Kutusu İçin) - Absolute, Justify-End, Z-Index 9999 */}
      <div 
        className="absolute left-0 right-0 z-[9999] flex flex-col justify-end w-full max-w-[500px] mx-auto pointer-events-none"
        style={{ bottom: `${kbOffset}px` }}
      >
        {/* Mesaj Kutusu İçin Portal Hedefi */}
        <div id="chat-input-portal" className="pointer-events-auto w-full flex-shrink-0" />

        {/* Alt Menü Tab Bar */}
        <div className="pointer-events-auto flex-shrink-0 bg-white/95 backdrop-blur-md border-t border-slate-200/80 flex justify-around items-center px-2 sm:px-6 py-2 pb-[max(8px,env(safe-area-inset-bottom))] w-full">
          <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'home' ? 'text-amber-500 scale-110' : 'text-slate-400'}`}>
            <span className="text-2xl">🏠</span>
            <span className="text-[10px] font-bold tracking-wide">Ana</span>
          </button>
          <button onClick={() => setActiveTab('namaz')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'namaz' ? 'text-sky-500 scale-110' : 'text-slate-400'}`}>
            <span className="text-2xl">🕌</span>
            <span className="text-[10px] font-bold tracking-wide">Namaz</span>
          </button>
          <button onClick={() => setActiveTab('chat')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'chat' ? 'text-pink-500 scale-110' : 'text-slate-400'}`}>
            <span className="text-2xl">💬</span>
            <span className="text-[10px] font-bold tracking-wide">Sohbet</span>
          </button>
          <button onClick={() => setActiveTab('canvas')} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 transition-all duration-200 ${activeTab === 'canvas' ? 'text-purple-500 scale-110' : 'text-slate-400'}`}>
            <span className="text-2xl">🎨</span>
            <span className="text-[10px] font-bold tracking-wide">Çizim</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
