import React from 'react';
import zenepPhoto from "../assets/zenepcan.jpeg";
import ametPhoto from "../assets/ametcan.jpeg";

const users = [
  { id: 'zenep', name: 'Zenepcan', avatar: zenepPhoto },
  { id: 'amet', name: 'Ametcan', avatar: ametPhoto }
];

export default function Header({ currentUser, setCurrentUser }) {
  return (
    <header className="pt-8 pb-6 px-4 bg-white/70 backdrop-blur-md sticky top-0 z-50 shadow-sm shadow-pink-100/50 border-b border-pink-100 rounded-b-[2.5rem]">
      <div className="max-w-xl mx-auto flex flex-col items-center">
        <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-sky-400 mb-6 drop-shadow-sm">
          Namaz Kıl CAN 🌸
        </h1>
        <p className="text-sm font-medium text-slate-400 mb-4 animate-pulse">Cihazınızı seçmek için profilinize dokunun 👇</p>
        <div className="flex gap-10 items-center justify-center">
          {users.map(user => {
            const isActive = currentUser === user.id;
            return (
              <div 
                key={user.name} 
                onClick={() => setCurrentUser(user.id)}
                className={`flex flex-col items-center group cursor-pointer transition-transform duration-300 ${isActive ? 'scale-110' : 'hover:scale-105 opacity-60 hover:opacity-100'}`}
              >
                <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 shadow-md overflow-hidden bg-white transition-colors duration-300
                  ${isActive ? 'border-pink-300 shadow-pink-200' : 'border-white group-hover:border-pink-100'}`}>
                  <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                </div>
                <span className={`mt-3 font-semibold text-lg px-4 py-1 rounded-full shadow-sm transition-colors
                  ${isActive ? 'text-pink-600 bg-pink-100' : 'text-slate-500 bg-white/70'}`}>
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
