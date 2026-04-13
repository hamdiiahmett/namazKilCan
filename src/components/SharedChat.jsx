import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { rtdb } from '../firebase';
import { ref, onValue, push, serverTimestamp, update } from 'firebase/database';
import { Send } from 'lucide-react';
import { format } from 'date-fns';

export default function SharedChat({ currentUser }) {
  const [messages, setMessages]   = useState([]);
  const [text, setText]           = useState('');
  const messagesEndRef             = useRef(null);

  const [activeMenuId, setActiveMenuId] = useState(null);
  const [editingId,    setEditingId]    = useState(null);
  const [editText,     setEditText]     = useState('');

  const [portalRoot, setPortalRoot] = useState(null);

  useEffect(() => {
    // Portal element App.jsx içinden geliyor
    setPortalRoot(document.getElementById('chat-input-portal'));
    
    // Resize listeners to keep messages scrolled
    const handler = () => {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    };
    window.visualViewport?.addEventListener('resize', handler);
    return () => window.visualViewport?.removeEventListener('resize', handler);
  }, []);

  // Firebase messages
  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        const msgs = Object.entries(snapshot.val())
          .map(([key, val]) => ({ id: key, ...val }));
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setMessages(msgs);
      } else {
        setMessages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Auto-scroll on new message
  useEffect(() => {
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

  const handleDelete = (id) => {
    update(ref(rtdb, `chat/messages/${id}`), { isDeleted: true, text: '🚫 Bu mesaj silindi' });
    setActiveMenuId(null);
  };

  const handleEditClick = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.text);
    setActiveMenuId(null);
  };

  const handleSaveEdit = (id) => {
    if (!editText.trim()) return;
    update(ref(rtdb, `chat/messages/${id}`), { text: editText.trim(), isEdited: true });
    setEditingId(null);
  };

  const inputForm = (
    <form
      onSubmit={handleSend}
      className="px-3 pt-2 pb-3 bg-fuchsia-50/95 backdrop-blur-md border-t border-slate-200 flex gap-2 w-full"
    >
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Tatlı bir şeyler yaz..."
        className="flex-1 bg-white border border-slate-200 rounded-full px-4 py-3 focus:ring-2 focus:ring-sky-200 outline-none text-slate-700 transition-all text-[16px] font-medium min-w-0 shadow-sm"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="bg-sky-400 hover:bg-sky-500 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 text-white w-12 h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-all shadow-sm"
      >
        <Send size={20} className="translate-x-0.5" />
      </button>
    </form>
  );

  return (
    <div className="flex flex-col h-full w-full mx-auto overflow-hidden">
      {/* ── 1. Chat header card ─────────────────── */}
      <div className="flex-shrink-0 z-20 sticky top-0 bg-fuchsia-50/90 backdrop-blur-sm px-3 pt-2 pb-1">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-sky-100 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <h2 className="font-bold text-slate-700 text-sm tracking-wide">Sohbetcan</h2>
          </div>
          <span className="text-lg">🧡</span>
        </div>
      </div>

      {/* ── 2. Messages ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3 pb-[180px]">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-slate-300 font-medium italic text-sm">
            Henüz kimse bir şey yazmamış...
          </div>
        )}

        {messages.map((msg, idx) => {
          const isMe = msg.senderId === currentUser;
          const timeString = msg.timestamp
            ? format(new Date(msg.timestamp), 'HH:mm') : '';

          return (
            <div key={msg.id || idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              {editingId === msg.id ? (
                /* Edit mode */
                <div className="w-full max-w-[92%] bg-white p-3 rounded-2xl shadow-md border border-sky-100 flex flex-col gap-2">
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
                    <button onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-slate-500 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors">
                      İptal
                    </button>
                    <button onClick={() => handleSaveEdit(msg.id)}
                      className="px-3 py-1.5 text-white bg-sky-400 rounded-md hover:bg-sky-500 transition-colors shadow-sm">
                      Kaydet
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal bubble */
                <div className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    onClick={() => {
                      if (isMe && !msg.isDeleted)
                        setActiveMenuId(activeMenuId === msg.id ? null : msg.id);
                    }}
                    className={[
                      'max-w-[80%] px-3 py-2 rounded-2xl shadow-sm relative text-[14px] leading-relaxed transition-colors',
                      isMe && !msg.isDeleted ? 'cursor-pointer hover:brightness-95' : '',
                      isMe
                        ? msg.isDeleted
                          ? 'bg-sky-100/60 text-slate-400 italic rounded-tr-none ml-auto'
                          : 'bg-sky-400 text-white rounded-tr-none ml-auto'
                        : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none mr-auto'
                    ].join(' ')}
                  >
                    {msg.type === 'image' && !msg.isDeleted ? (
                      <div className="mt-1 mb-1 relative">
                        <img
                          src={msg.imageUrl} alt="Çizim"
                          className="rounded-xl w-full max-w-[200px] border-2 border-white/20 shadow-sm bg-white"
                        />
                        <a
                          href={msg.imageUrl}
                          download={`cizim-${msg.timestamp || Date.now()}.png`}
                          title="İndir"
                          onClick={e => e.stopPropagation()}
                          className="absolute bottom-1 right-1 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" x2="12" y1="15" y2="3" />
                          </svg>
                        </a>
                      </div>
                    ) : (
                      <div className="break-words">{msg.text}</div>
                    )}

                    <div className={`flex justify-end items-center gap-1 text-[10px] mt-0.5
                      ${isMe ? (msg.isDeleted ? 'text-slate-400' : 'text-sky-100') : 'text-slate-400'}`}>
                      {msg.isEdited && !msg.isDeleted && (
                        <span className="opacity-80 font-medium">(düzenlendi)</span>
                      )}
                      <span>{timeString}</span>
                    </div>
                  </div>

                  {activeMenuId === msg.id && (
                    <div className="mt-1.5 flex gap-2 justify-end mr-1 z-10">
                      {msg.type !== 'image' && (
                        <button onClick={() => handleEditClick(msg)}
                          className="text-xs font-medium bg-white text-slate-600 px-3 py-1.5 rounded-lg shadow-sm border border-slate-100 hover:bg-slate-50 transition-colors">
                          Düzenle
                        </button>
                      )}
                      <button onClick={() => handleDelete(msg.id)}
                        className="text-xs font-medium bg-white text-red-500 px-3 py-1.5 rounded-lg shadow-sm border border-red-100 hover:bg-red-50 transition-colors">
                        Sil
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Scroll anchor with padding so last message doesn't hug input edge */}
        <div ref={messagesEndRef} className="pb-4" />
      </div>

      {/* ── 3. Input bar injected into App.jsx portal ─── */}
      {portalRoot ? createPortal(inputForm, portalRoot) : inputForm}
    </div>
  );
}
