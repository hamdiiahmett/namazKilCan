import React, { useState, useEffect, Suspense, lazy } from 'react';
import Header from './components/Header';

// Lazy loading components for performance
const Home = lazy(() => import('./components/Home'));
const PrayerTracker = lazy(() => import('./components/PrayerTracker'));
const SharedChat = lazy(() => import('./components/SharedChat'));
const SharedCanvas = lazy(() => import('./components/SharedCanvas'));

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || 'zenep';
  });
  const [activeTab, setActiveTab] = useState('home');
  const [kbOffset, setKbOffset] = useState(0);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);

  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  // Handle mobile keyboard layout shifts
  useEffect(() => {
    const handleResize = () => {
      const vv = window.visualViewport;
      if (vv) {
        const height = vv.height;
        const kh = window.innerHeight - height;
        const isOpen = kh > 150;

        if (isOpen) {
          setKbOffset(kh);
        } else {
          setKbOffset(0);
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
    <div
      className="bg-slate-50 text-slate-800 font-sans selection:bg-sky-100 flex flex-col overflow-hidden"
      style={{ position: 'fixed', inset: 0 }}
    >
      {/* Header kismi */}
      <div className="flex-shrink-0 z-30">
        <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
      </div>

      {/* Main content */}
      <main className={`flex-1 min-h-0 w-full max-w-[500px] mx-auto flex flex-col relative bg-white ${activeTab !== 'chat' ? 'pb-[140px]' : 'pb-[56px]'}`}>
        <div className={`flex-1 min-h-0 w-full flex flex-col ${activeTab !== 'chat' ? 'overflow-y-auto overflow-x-hidden pt-3' : 'overflow-hidden'}`}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm italic">Hazırlanıyor...</div>}>
            {activeTab === 'home' && <Home currentUser={currentUser} />}
            {activeTab === 'namaz' && <PrayerTracker />}
            {activeTab === 'chat' && <SharedChat currentUser={currentUser} />}
            {activeTab === 'canvas' && (
              <div className="px-2 sm:px-4">
                <SharedCanvas currentUser={currentUser} onFullscreenChange={setIsCanvasFullscreen} />
              </div>
            )}
          </Suspense>
        </div>
      </main>

      {/* Alt Menü Tab Bar */}
      {(!isCanvasFullscreen || activeTab !== 'canvas') && (
        <div
          className="absolute left-0 right-0 z-[9999] flex flex-col justify-end w-full max-w-[500px] mx-auto pointer-events-none"
          style={{ bottom: `${kbOffset}px` }}
        >
          <div className="pointer-events-auto flex-shrink-0 bg-white/95 backdrop-blur-md border-t border-slate-100 flex justify-around items-center px-2 sm:px-6 py-2 pb-[max(8px,env(safe-area-inset-bottom))] w-full shadow-[0_-1px_10px_rgba(0,0,0,0.05)]">
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
      )}
    </div>
  );
}

export default App;
