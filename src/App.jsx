import React, { useState, useEffect, useCallback, Suspense, lazy, memo } from 'react';
import { Home as HomeIcon, Moon, MessageCircle, Palette } from 'lucide-react';
import Header from './components/Header';

// Lazy loading components for performance
const Home = lazy(() => import('./components/Home'));
const PrayerTracker = lazy(() => import('./components/PrayerTracker'));
const SharedChat = lazy(() => import('./components/SharedChat'));
const SharedCanvas = lazy(() => import('./components/SharedCanvas'));

// ── Floating Flower Petals ──────────────────────────────────────────────────
const FloatingPetals = memo(() => (
  <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
    <span className="petal" style={{ left: '8%', bottom: '-20px' }}>🌸</span>
    <span className="petal" style={{ left: '22%', bottom: '-20px' }}>💮</span>
    <span className="petal" style={{ left: '45%', bottom: '-20px' }}>🌷</span>
    <span className="petal" style={{ left: '65%', bottom: '-20px' }}>🌺</span>
    <span className="petal" style={{ left: '82%', bottom: '-20px' }}>🌼</span>
    <span className="petal" style={{ left: '38%', bottom: '-20px' }}>🪻</span>
  </div>
));
FloatingPetals.displayName = 'FloatingPetals';

// ── Tab Bar Item ────────────────────────────────────────────────────────────
const tabs = [
  { id: 'home', label: 'Ana', Icon: HomeIcon, color: 'from-amber-400 to-orange-400', activeColor: 'text-amber-500', activeBg: 'bg-amber-50' },
  { id: 'namaz', label: 'Namaz', Icon: Moon, color: 'from-sky-400 to-blue-500', activeColor: 'text-sky-500', activeBg: 'bg-sky-50' },
  { id: 'chat', label: 'Sohbet', Icon: MessageCircle, color: 'from-pink-400 to-rose-500', activeColor: 'text-pink-500', activeBg: 'bg-pink-50' },
  { id: 'canvas', label: 'Çizim', Icon: Palette, color: 'from-purple-400 to-violet-500', activeColor: 'text-purple-500', activeBg: 'bg-purple-50' },
];

const TabButton = memo(({ tab, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1.5 rounded-2xl transition-all duration-300 ${
      isActive
        ? `${tab.activeColor} ${tab.activeBg} scale-105 shadow-sm`
        : 'text-slate-400 hover:text-slate-500 active:scale-95'
    }`}
  >
    <tab.Icon
      size={22}
      strokeWidth={isActive ? 2.5 : 2}
      className={`transition-all duration-300 ${isActive ? 'drop-shadow-sm' : ''}`}
    />
    <span className={`text-[10px] font-bold tracking-wide transition-all ${isActive ? 'opacity-100' : 'opacity-70'}`}>
      {tab.label}
    </span>
    {isActive && (
      <div className={`w-5 h-0.5 rounded-full bg-gradient-to-r ${tab.color} mt-0.5`} />
    )}
  </button>
));
TabButton.displayName = 'TabButton';

// ── Loading Fallback ────────────────────────────────────────────────────────
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="flex flex-col items-center gap-3 animate-pulse">
      <span className="text-3xl">🌸</span>
      <span className="text-sm font-medium text-pink-300">Hazırlanıyor...</span>
    </div>
  </div>
);

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

  // Handle mobile keyboard layout shifts — throttled with RAF
  useEffect(() => {
    let rafId = null;

    const handleResize = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const vv = window.visualViewport;
        if (vv) {
          const kh = window.innerHeight - vv.height;
          setKbOffset(kh > 150 ? kh : 0);
        }
      });
    };

    if (window.visualViewport) {
      handleResize();
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
    };
  }, []);

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
  }, []);

  return (
    <div
      className="text-slate-800 flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        inset: 0,
        fontFamily: "var(--font-family)",
        background: 'linear-gradient(180deg, #fdf2f8 0%, #fce7f3 30%, #fff1f2 60%, #fdf2f8 100%)',
      }}
    >
      {/* Floating Flower Petals */}
      <FloatingPetals />

      {/* Header */}
      <div className={`flex-shrink-0 relative ${isCanvasFullscreen ? 'z-0' : 'z-30'}`}>
        <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
      </div>

      {/* Main content */}
      <main className={`flex-1 min-h-0 w-full max-w-[500px] mx-auto flex flex-col relative ${isCanvasFullscreen ? 'z-50' : 'z-10'} ${activeTab !== 'chat' ? 'pb-[72px]' : 'pb-[56px]'}`}>
        <div className={`flex-1 min-h-0 w-full flex flex-col ${activeTab !== 'chat' ? 'overflow-y-auto overflow-x-hidden pt-3' : 'overflow-hidden'}`}>
          <Suspense fallback={<LoadingFallback />}>
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

      {/* Bottom Tab Bar */}
      {(!isCanvasFullscreen || activeTab !== 'canvas') && (
        <div
          className="absolute left-0 right-0 z-[9999] flex flex-col justify-end w-full max-w-[500px] mx-auto pointer-events-none"
          style={{ bottom: `${kbOffset}px` }}
        >
          <div className="pointer-events-auto flex-shrink-0 glass-strong border-t border-pink-100/50 flex justify-around items-center px-3 sm:px-6 py-2 pb-[max(8px,env(safe-area-inset-bottom))] w-full shadow-[0_-4px_20px_rgba(236,72,153,0.08)]">
            {tabs.map(tab => (
              <TabButton
                key={tab.id}
                tab={tab}
                isActive={activeTab === tab.id}
                onClick={() => handleTabChange(tab.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
