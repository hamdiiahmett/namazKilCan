import React from 'react';
import zenepPhoto from "../assets/zenepcan.jpeg";
import ametPhoto from "../assets/ametcan.jpeg";

const users = [
  { id: 'zenep', name: 'Zenepcan', avatar: zenepPhoto },
  { id: 'amet', name: 'Ametcan', avatar: ametPhoto }
];

export default function Header({ currentUser, setCurrentUser }) {
  return (
    <header className="pt-4 pb-3 sm:pt-6 sm:pb-5 px-4 bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm shadow-pink-100/50 border-b border-pink-100 rounded-b-3xl sm:rounded-b-[2.5rem]">
      <div className="max-w-xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0">
        <div className="flex flex-col items-center sm:items-start w-full sm:w-auto">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-sky-400 drop-shadow-sm text-center sm:text-left">
            CANCAN 🌸
          </h1>
          <p className="text-[11px] sm:text-sm font-medium text-slate-400 animate-pulse mt-1">
            Cihazınızı seçmek için profilinize dokunun :o
          </p>
        </div>

        <div className="flex gap-6 sm:gap-8 items-center justify-center">
          {users.map(user => {
            const isActive = currentUser === user.id;
            return (
              <div
                key={user.name}
                onClick={() => setCurrentUser(user.id)}
                className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-2 group cursor-pointer transition-transform duration-300 ${isActive ? 'scale-105 sm:scale-110' : 'opacity-70 hover:opacity-100'}`}
              >
                <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full border-[3px] shadow-sm overflow-hidden bg-white transition-colors duration-300
                  ${isActive ? 'border-pink-400 shadow-pink-200' : 'border-white group-hover:border-pink-200'}`}>
                  <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                </div>
                <span className={`text-[11px] sm:text-sm font-bold px-3 py-0.5 sm:py-1 rounded-full sm:shadow-sm transition-colors
                  ${isActive ? 'text-pink-600 bg-pink-100 sm:bg-pink-100' : 'text-slate-500 bg-slate-100 sm:bg-white/70'}`}>
                  {user.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </header>
  );
}
