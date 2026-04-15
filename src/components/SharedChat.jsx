import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, onChildChanged, push, serverTimestamp, update } from 'firebase/database';
import { Send } from 'lucide-react';
import { format } from 'date-fns';

// ── Mesaj balonu ────────────────────────────────────────────────────────────────
const MessageBubble = memo(({
  msg, currentUser,
  activeMenuId, setActiveMenuId,
  onEditClick, onDelete,
  editingId, editText, setEditText, onSaveEdit, setEditingId,
}) => {
  const isMe = msg.senderId === currentUser;
  const timeStr = msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : '';

  return (
    <div className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
      {/* ── Düzenleme modu ── */}
      {editingId === msg.id ? (
        <div className="w-full max-w-[92%] bg-white p-3 rounded-2xl shadow-md border border-sky-100 flex flex-col gap-2">
          <input
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-[16px] outline-none focus:border-sky-300 transition-colors"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit(msg.id);
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
          <div className="flex justify-end gap-2 text-xs font-medium">
            <button onClick={() => setEditingId(null)}
              className="px-3 py-1.5 text-slate-500 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors">
              İptal
            </button>
            <button onClick={() => onSaveEdit(msg.id)}
              className="px-3 py-1.5 text-white bg-sky-400 rounded-md hover:bg-sky-500 transition-colors shadow-sm">
              Kaydet
            </button>
          </div>
        </div>
      ) : (
        /* ── Normal mesaj ── */
        <div className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>
          <div
            onClick={() => {
              if (isMe && !msg.isDeleted)
                setActiveMenuId(activeMenuId === msg.id ? null : msg.id);
            }}
            className={[
              'max-w-[80%] px-3 py-2 rounded-2xl shadow-sm relative text-[14px] leading-relaxed transition-all',
              isMe && !msg.isDeleted ? 'cursor-pointer hover:scale-[0.98]' : '',
              isMe
                ? msg.isDeleted
                  ? 'bg-sky-100/60 text-slate-400 italic rounded-tr-none'
                  : 'bg-sky-400 text-white rounded-tr-none'
                : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none',
            ].join(' ')}
          >
            {msg.type === 'image' && !msg.isDeleted ? (
              <div className="mt-1 mb-1 relative">
                <img
                  src={msg.imageUrl} alt="Çizim" loading="lazy"
                  className="rounded-xl w-full max-w-[200px] border-2 border-white/20 shadow-sm bg-white"
                />
              </div>
            ) : (
              <div className="break-words">{msg.text}</div>
            )}

            <div className={`flex justify-end items-center gap-1 text-[10px] mt-0.5
              ${isMe ? (msg.isDeleted ? 'text-slate-400' : 'text-sky-100') : 'text-slate-400'}`}>
              {msg.isEdited && !msg.isDeleted && (
                <span className="opacity-80 font-medium">(düzenlendi)</span>
              )}
              <span>{timeStr}</span>
            </div>
          </div>

          {/* Bağlam menüsü */}
          {activeMenuId === msg.id && (
            <div className="mt-1.5 flex gap-2 justify-end mr-1 z-10 animate-in fade-in slide-in-from-top-1 duration-200">
              {msg.type !== 'image' && (
                <button onClick={() => onEditClick(msg)}
                  className="text-xs font-medium bg-white text-slate-600 px-3 py-1.5 rounded-lg shadow-sm border border-slate-100 hover:bg-slate-50 transition-colors">
                  Düzenle
                </button>
              )}
              <button onClick={() => onDelete(msg.id)}
                className="text-xs font-medium bg-white text-red-500 px-3 py-1.5 rounded-lg shadow-sm border border-red-100 hover:bg-red-50 transition-colors">
                Sil
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';

// ══════════════════════════════════════════════════════════════════════════════
//  SHARED CHAT
// ══════════════════════════════════════════════════════════════════════════════
export default function SharedChat({ currentUser }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const messagesEndRef = useRef(null);
  const messagesMapRef = useRef(new Map());

  // Auto-scroll logic
  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  // ── Firebase Listener ──────────────────────────────────────────────────────
  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');

    const unsubAdded = onChildAdded(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      const msg = { id: snapshot.key, ...val };
      messagesMapRef.current.set(snapshot.key, msg);
      setMessages(prev => {
        if (prev.some(m => m.id === snapshot.key)) return prev;
        const next = [...prev, msg].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        return next;
      });
    });

    const unsubChanged = onChildChanged(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      const updated = { id: snapshot.key, ...val };
      messagesMapRef.current.set(snapshot.key, updated);
      setMessages(prev => prev.map(m => m.id === snapshot.key ? updated : m));
    });

    return () => { unsubAdded(); unsubChanged(); };
  }, []);

  // Yeni mesaj gelince veya sayfa açılınca scroll
  useEffect(() => {
    scrollToBottom('auto');
    // Animasyonlar bittikten sonra tekrar emin olalım
    const timer = setTimeout(() => scrollToBottom('smooth'), 100);
    return () => clearTimeout(timer);
  }, [messages.length]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSend = useCallback((e) => {
    e.preventDefault();
    if (!text.trim()) return;
    push(ref(rtdb, 'chat/messages'), {
      text: text.trim(),
      senderId: currentUser,
      timestamp: serverTimestamp(),
    });
    setText('');
    setTimeout(() => scrollToBottom('smooth'), 50);
  }, [text, currentUser]);

  const handleDelete = useCallback((id) => {
    update(ref(rtdb, `chat/messages/${id}`), { isDeleted: true, text: '🚫 Bu mesaj silindi' });
    setActiveMenuId(null);
  }, []);

  const handleEditClick = useCallback((msg) => {
    setEditingId(msg.id);
    setEditText(msg.text);
    setActiveMenuId(null);
  }, []);

  const handleSaveEdit = useCallback((id) => {
    if (!editText.trim()) return;
    update(ref(rtdb, `chat/messages/${id}`), { text: editText.trim(), isEdited: true });
    setEditingId(null);
  }, [editText]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden">

      {/* ── 1. Başlık (Sohbetcan) ── */}
      <div className="flex-shrink-0 z-10 bg-white/95 backdrop-blur-sm sticky top-0 border-b border-slate-100">
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">💬</span>
            <div className="flex flex-col">
              <h2 className="font-bold text-slate-700 text-[14px] leading-tight tracking-tight">Sohbetcan</h2>
              <span className="text-[10px] text-slate-400 font-medium">VOOOOOOOOOOO🧡</span>
            </div>
          </div>
          <div className="flex -space-x-2">
            <div className="w-7 h-7 rounded-full bg-sky-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-sky-600">Z</div>
            <div className="w-7 h-7 rounded-full bg-pink-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-pink-600">A</div>
          </div>
        </div>
      </div>

      {/* ── 2. Mesaj Listesi Alanı ── */}
      <div className="flex-1 overflow-y-auto flex flex-col p-4 space-y-3 overscroll-contain">
        {/* Kritk İtici: Mesajlar azken en alttan başlamasını sağlar */}
        <div className="flex-1 min-h-[20px]"></div>

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center opacity-40 grayscale">
            <span className="text-4xl mb-2">🎈</span>
            <p className="text-xs font-medium text-slate-500">Henüz mesaj yok.<br />İlk selamı sen ver!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              currentUser={currentUser}
              activeMenuId={activeMenuId}
              setActiveMenuId={setActiveMenuId}
              onEditClick={handleEditClick}
              onDelete={handleDelete}
              editingId={editingId}
              editText={editText}
              setEditText={setEditText}
              onSaveEdit={handleSaveEdit}
              setEditingId={setEditingId}
            />
          ))
        )}

        {/* Otomatik Scroll Anchor */}
        <div ref={messagesEndRef} className="h-0 w-0" />
      </div>

      {/* ── 3. Yazma Kutusu (Input Area) ── */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 p-3 pb-[80px]">
        <form onSubmit={handleSend} className="max-w-[500px] mx-auto">
          <div className="flex items-center bg-slate-100/80 rounded-[24px] border border-slate-200/50 shadow-inner px-1.5 py-1.5 gap-2 group transition-all focus-within:bg-white focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100/50">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Birbirinizi övün :o ..."
              className="flex-1 bg-transparent border-none focus:ring-0 outline-none px-4 text-slate-700 text-[16px] font-medium min-w-0 placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="bg-sky-500 hover:bg-sky-600 active:scale-95 disabled:bg-slate-300 disabled:shadow-none text-white w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(14,165,233,0.3)]"
            >
              <Send size={18} className="translate-x-0.5" />
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
