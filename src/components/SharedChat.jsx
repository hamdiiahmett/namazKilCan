import React, { useState, useEffect, useRef } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, push, serverTimestamp } from 'firebase/database';
import { Send } from 'lucide-react';
import { format } from 'date-fns';

export default function SharedChat({ currentUser }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        const msgs = Object.values(snapshot.val());
        // Sıralama
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setMessages(msgs);
      } else {
        setMessages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Scroll to bottom
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    push(ref(rtdb, 'chat/messages'), {
      text: text.trim(),
      senderId: currentUser,
      timestamp: serverTimestamp()
    });
    setText('');
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-[2rem] shadow-sm border border-sky-100/50 flex flex-col overflow-hidden h-[450px]">
      <div className="bg-gradient-to-r from-sky-100 to-pink-100 p-4 border-b border-white shadow-sm z-10 flex justify-between items-center">
        <h2 className="font-bold text-slate-700">Ortak Not Defteri 💭</h2>
        <span className="text-xs bg-white/60 px-2 py-1 rounded-full text-slate-500 font-medium">Uçtan Uca Şifresiz 🙈</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-slate-300 font-medium italic">
            Henüz kimse bir şey yazmamış...
          </div>
        )}
        
        {messages.map((msg, idx) => {
          const isMe = msg.senderId === currentUser;
          // Simple time format if timestamp exists
          const timeString = msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : '';

          return (
            <div key={idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm relative text-[15px] leading-relaxed
                  ${isMe 
                    ? 'bg-sky-400 text-white rounded-tr-none' 
                    : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'}`}
              >
                <div className="break-words">{msg.text}</div>
                <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-sky-100' : 'text-slate-400'}`}>
                  {timeString}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="p-3 bg-white border-t border-slate-100 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tatlı bir şeyler yaz..."
          className="flex-1 bg-slate-50 border-none rounded-full px-4 py-3 focus:ring-2 focus:ring-sky-200 outline-none text-slate-700 transition-all font-medium"
        />
        <button 
          type="submit" 
          disabled={!text.trim()}
          className="bg-sky-400 hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-400 text-white w-12 h-12 rounded-full flex items-center justify-center transition-colors shadow-sm"
        >
          <Send size={18} className="translate-x-0.5" />
        </button>
      </form>
    </div>
  );
}
