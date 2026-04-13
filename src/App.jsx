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

  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  return (
    <div className="h-[100dvh] bg-fuchsia-50 text-slate-800 font-sans selection:bg-pink-300 overflow-hidden flex flex-col">
      <div className="flex-shrink-0">
        <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
      </div>
      
      <main className="flex-1 w-full max-w-xl mx-auto px-2 sm:px-4 flex flex-col gap-2 overflow-hidden pb-2">
        <div className="flex-shrink-0 mt-2">
          <PrayerTracker />
        </div>
        
        <div className="flex bg-white/60 backdrop-blur-sm rounded-full p-1 mx-auto text-sm w-fit shadow-sm flex-shrink-0">
          <button onClick={() => setActiveTab('chat')} className={`px-6 py-1.5 rounded-full transition-colors font-medium ${activeTab === 'chat' ? 'bg-sky-400 text-white shadow-md' : 'text-slate-600 hover:bg-white/50'}`}>💬 Sohbet</button>
          <button onClick={() => setActiveTab('canvas')} className={`px-6 py-1.5 rounded-full transition-colors font-medium ${activeTab === 'canvas' ? 'bg-purple-400 text-white shadow-md' : 'text-slate-600 hover:bg-white/50'}`}>🎨 Çizim</button>
        </div>

        <div className="flex-1 min-h-0 relative transition-all duration-300">
          {activeTab === 'chat' ? (
             <SharedChat currentUser={currentUser} />
          ) : (
             <SharedCanvas currentUser={currentUser} />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
