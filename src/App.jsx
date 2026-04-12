import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import PrayerTracker from './components/PrayerTracker';
import SharedChat from './components/SharedChat';
import SharedCanvas from './components/SharedCanvas';

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || 'zenep';
  });

  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  return (
    <div className="min-h-screen bg-fuchsia-50 text-slate-800 pb-10 sm:pb-20 font-sans selection:bg-pink-300">
      <Header currentUser={currentUser} setCurrentUser={setCurrentUser} />
      <main className="max-w-xl mx-auto px-2 sm:px-4 mt-4 sm:mt-6 space-y-4 sm:space-y-6">
        <PrayerTracker />
        <SharedChat currentUser={currentUser} />
        <SharedCanvas currentUser={currentUser} />
      </main>
    </div>
  );
}

export default App;
