import React, { useState, useEffect, useRef } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, push, serverTimestamp, update } from 'firebase/database';
import { Send, Maximize2, Minimize2 } from 'lucide-react';
import { format } from 'date-fns';

export default function SharedChat({ currentUser }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const messagesEndRef = useRef(null);

  const [activeMenuId, setActiveMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState('100dvh');

  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        const msgs = Object.entries(snapshot.val()).map(([key, val]) => ({
          id: key,
          ...val
        }));
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
    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const handleResize = () => {
      if (window.visualViewport) {
        setViewportHeight(`${window.visualViewport.height}px`);
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      setViewportHeight(`${window.visualViewport.height}px`);
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

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

  const handleDelete = (id) => {
    update(ref(rtdb, `chat/messages/${id}`), {
      isDeleted: true,
      text: '🚫 Bu mesaj silindi'
    });
    setActiveMenuId(null);
  };

  const handleEditClick = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.text);
    setActiveMenuId(null);
  };

  const handleSaveEdit = (id) => {
    if (!editText.trim()) return;
    update(ref(rtdb, `chat/messages/${id}`), {
      text: editText.trim(),
      isEdited: true
    });
    setEditingId(null);
  };
  return (
    <div
      style={{ height: isFullscreen ? viewportHeight : undefined }}
      className={`bg-white/80 backdrop-blur-sm shadow-sm border border-sky-100/50 flex flex-col overflow-hidden w-full transition-all duration-300 ease-in-out
        ${isFullscreen
          ? 'fixed inset-0 z-[100] rounded-none bg-white/95'
          : 'rounded-3xl sm:rounded-[2rem] h-[60vh] sm:h-[500px] relative'}`}
    >
      <div className={`bg-gradient-to-r from-sky-100 to-pink-100 p-4 border-b border-white shadow-sm z-10 flex justify-between items-center ${isFullscreen ? 'sm:px-6' : ''}`}>
        <h2 className="font-bold text-slate-700"> Sohbetcan 💭</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-white/60 px-2 py-1 rounded-full text-slate-500 font-medium hidden sm:inline-block">Uçtan Uca Şifresiz 🙈</span>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-full bg-white/60 text-slate-600 hover:text-slate-800 hover:bg-white/80 transition-colors shadow-sm"
            title="Tam Ekran"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 bg-slate-50/50 flex flex-col relative">
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
            <div key={msg.id || idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              {editingId === msg.id ? (
                // Editing UI
                <div className="w-full max-w-[95%] sm:max-w-[85%] bg-white p-3 rounded-2xl shadow-md border border-sky-100 flex flex-col gap-2">
                  <input
                    autoFocus
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-[16px] outline-none focus:border-sky-300 transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(msg.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <div className="flex justify-end gap-2 text-xs font-medium">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-slate-500 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors">İptal</button>
                    <button onClick={() => handleSaveEdit(msg.id)} className="px-3 py-1.5 text-white bg-sky-400 rounded-md hover:bg-sky-500 transition-colors shadow-sm">Kaydet</button>
                  </div>
                </div>
              ) : (
                // Normal Bubble
                <div className="flex flex-col items-end w-full">
                  <div
                    onClick={() => {
                      if (isMe && !msg.isDeleted) {
                        setActiveMenuId(activeMenuId === msg.id ? null : msg.id);
                      }
                    }}
                    className={`max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl shadow-sm relative text-[14px] sm:text-[15px] leading-relaxed transition-colors ${isMe && !msg.isDeleted ? 'cursor-pointer hover:brightness-95' : ''}
                      ${isMe
                        ? msg.isDeleted
                          ? 'bg-sky-100/60 text-slate-400 italic rounded-tr-none'
                          : 'bg-sky-400 text-white rounded-tr-none'
                        : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none self-start'} ${!isMe ? 'mr-auto' : 'ml-auto'}`}
                  >
                    {msg.type === 'image' && !msg.isDeleted ? (
                      <div className="mt-1 mb-1 relative">
                        <img
                          src={msg.imageUrl}
                          alt="Çizim"
                          className="rounded-xl w-full max-w-[200px] border-2 border-white/20 shadow-sm bg-white"
                        />
                        <a
                          href={msg.imageUrl}
                          download={`cizim-${msg.timestamp || Date.now()}.png`}
                          title="İndir"
                          onClick={(e) => e.stopPropagation()}
                          className="absolute bottom-1 right-1 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        </a>
                      </div>
                    ) : (
                      <div className="break-words">
                        {msg.text}
                      </div>
                    )}
                    <div className={`flex justify-end items-center gap-1 text-[10px] mt-1 ${isMe ? (msg.isDeleted ? 'text-slate-400' : 'text-sky-100') : 'text-slate-400'}`}>
                      {msg.isEdited && !msg.isDeleted && <span className="opacity-80 font-medium">(düzenlendi)</span>}
                      <span>{timeString}</span>
                    </div>
                  </div>

                  {/* Menu Options */}
                  {activeMenuId === msg.id && (
                    <div className="mt-1.5 flex gap-2 justify-end mr-1 animate-in fade-in duration-200 z-10">
                      {msg.type !== 'image' && (
                        <button
                          onClick={() => handleEditClick(msg)}
                          className="text-xs font-medium bg-white text-slate-600 px-3 py-1.5 rounded-lg shadow-sm border border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          Düzenle
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(msg.id)}
                        className="text-xs font-medium bg-white text-red-500 px-3 py-1.5 rounded-lg shadow-sm border border-red-100 hover:bg-red-50 transition-colors"
                      >
                        Sil
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="p-2 sm:p-3 bg-white border-t border-slate-100 flex gap-2 sticky bottom-0 z-20">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tatlı bir şeyler yaz..."
          className="flex-1 bg-slate-50 border-none rounded-full px-4 py-2.5 sm:py-3 focus:ring-2 focus:ring-sky-200 outline-none text-slate-700 transition-all text-[16px] font-medium min-w-0"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-sky-400 hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-400 text-white w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors shadow-sm"
        >
          <Send size={18} className="translate-x-0.5" />
        </button>
      </form>
    </div>
  );
}
