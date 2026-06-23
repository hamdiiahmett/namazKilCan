import React, { memo } from 'react';
import zenepPhoto from "../assets/zenepcan.jpeg";
import ametPhoto from "../assets/ametcan.jpeg";

const users = [
  { id: 'zenep', name: 'Zenepcan', avatar: zenepPhoto, emoji: '🌷' },
  { id: 'amet', name: 'Ametcan', avatar: ametPhoto, emoji: '🌿' }
];

// Profil avatarı — sadece aktiflik değişince re-render
const UserAvatar = memo(({ user, isActive, onClick }) => (
  <div
    onClick={onClick}
    className={`flex flex-col items-center gap-1.5 group cursor-pointer transition-all duration-500 ${
      isActive ? 'scale-105' : 'opacity-60 hover:opacity-90'
    }`}
  >
    <div className="relative">
      <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden transition-all duration-500 ${
        isActive 
          ? 'ring-[3px] ring-pink-400 ring-offset-2 ring-offset-white shadow-lg shadow-pink-200/50' 
          : 'ring-2 ring-white/80 group-hover:ring-pink-200'
      }`}>
        <img
          src={user.avatar}
          alt={user.name}
          loading="eager"
          decoding="async"
          width={64}
          height={64}
          className="w-full h-full object-cover"
        />
      </div>
    </div>

    {/* Name Badge */}
    <span className={`text-[11px] sm:text-xs font-bold px-3 py-0.5 rounded-full transition-all duration-300 ${
      isActive 
        ? 'text-pink-600 bg-pink-100/80 shadow-sm' 
        : 'text-slate-500 bg-white/50 group-hover:bg-pink-50/50'
    }`}>
      {user.emoji} {user.name}
    </span>
  </div>
));
UserAvatar.displayName = 'UserAvatar';

const Header = memo(({ currentUser, setCurrentUser }) => {
  return (
    <header className="pt-4 pb-3 sm:pt-5 sm:pb-4 px-4 glass-strong border-b border-pink-100/50 shadow-[0_4px_20px_rgba(236,72,153,0.06)]"
      style={{ borderRadius: '0 0 1.5rem 1.5rem' }}
    >
      <div className="max-w-xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0">
        {/* Logo & Subtitle */}
        <div className="flex flex-col items-center sm:items-start w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 30%, #38bdf8 70%, #0ea5e9 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              CANCAN
            </h1>
            <span className="text-xl animate-bounce-in" style={{ animationDelay: '0.3s' }}>🌸</span>
          </div>
          <p className="text-[10px] sm:text-xs font-medium text-slate-400 mt-0.5 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Profilinize dokunarak giriş yapın
          </p>
        </div>

        {/* User Avatars */}
        <div className="flex gap-6 sm:gap-8 items-center justify-center">
          {users.map(user => (
            <UserAvatar
              key={user.id}
              user={user}
              isActive={currentUser === user.id}
              onClick={() => setCurrentUser(user.id)}
            />
          ))}
        </div>
      </div>
    </header>
  );
});
Header.displayName = 'Header';

export default Header;
