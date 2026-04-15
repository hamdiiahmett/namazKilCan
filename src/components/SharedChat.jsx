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
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>

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
              'max-w-[80%] px-3 py-2 rounded-2xl shadow-sm relative text-[14px] leading-relaxed transition-colors',
              isMe && !msg.isDeleted ? 'cursor-pointer hover:brightness-95' : '',
              isMe
                ? msg.isDeleted
                  ? 'bg-sky-100/60 text-slate-400 italic rounded-tr-none ml-auto'
                  : 'bg-sky-400 text-white rounded-tr-none ml-auto'
                : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none mr-auto',
            ].join(' ')}
          >
            {msg.type === 'image' && !msg.isDeleted ? (
              <div className="mt-1 mb-1 relative">
                <img
                  src={msg.imageUrl} alt="Çizim" loading="lazy"
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
              <span>{timeStr}</span>
            </div>
          </div>

          {/* Bağlam menüsü */}
          {activeMenuId === msg.id && (
            <div className="mt-1.5 flex gap-2 justify-end mr-1 z-10">
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
//  SHARED CHAT — Self-contained layout, VisualViewport klavye yönetimi
// ══════════════════════════════════════════════════════════════════════════════
export default function SharedChat({ currentUser }) {
  const [messages,     setMessages]     = useState([]);
  const [text,         setText]         = useState('');
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [editingId,    setEditingId]    = useState(null);
  const [editText,     setEditText]     = useState('');

  // Layout ölçümleri — VisualViewport ile gerçek klavye yüksekliği
  const [kbHeight, setKbHeight] = useState(0);  // klavye yüksekliği (px)

  const messagesEndRef  = useRef(null);
  const listRef         = useRef(null);
  const messagesMapRef  = useRef(new Map());

  // ── VisualViewport: klavye yüksekliğini hesapla ────────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const onVVChange = () => {
      // Klavye yüksekliği = layout height − visible height
      const kb = window.innerHeight - vv.height;
      setKbHeight(kb > 50 ? kb : 0);
    };

    vv.addEventListener('resize', onVVChange);
    vv.addEventListener('scroll', onVVChange);
    return () => {
      vv.removeEventListener('resize', onVVChange);
      vv.removeEventListener('scroll', onVVChange);
    };
  }, []);

  // Klavye açılınca son mesaja otomatik kaydır
  useEffect(() => {
    if (kbHeight > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 120);
    }
  }, [kbHeight]);

  // ── Firebase ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');

    const unsubAdded = onChildAdded(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      const msg = { id: snapshot.key, ...val };
      messagesMapRef.current.set(snapshot.key, msg);
      setMessages(prev => {
        if (prev.some(m => m.id === snapshot.key)) return prev;
        return [...prev, msg].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
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

  // Yeni mesaj gelince otomatik kaydır
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
  //
  //  Yerleşim Modeli (klavye kapalı):
  //  ┌──────────────────────────────────┐  ← App Header (flex-shrink-0, z-50)
  //  │ Sohbetcan başlığı (sticky z-50)  │
  //  ├──────────────────────────────────┤
  //  │                                  │
  //  │  Mesaj Listesi  (flex-1, scroll) │
  //  │                                  │
  //  ├──────────────────────────────────┤
  //  │ Mesaj Yazma Kutusu               │  ← flex-shrink-0
  //  ├──────────────────────────────────┤
  //  │ Alt Menü (App.jsx'te)            │  ← App abs bottom
  //  └──────────────────────────────────┘
  //
  //  Klavye açıkken: kbHeight px yukarı kayan bottom bar (App.jsx kbOffset)
  //  Mesaj listesi: kalan tüm boşluğu doldurur (flex-1)
  //
  return (
    <div className="flex flex-col w-full h-full overflow-hidden">

      {/* ── 1. Sohbetcan başlığı — sticky, z-50 ── */}
      <div className="flex-shrink-0 z-50 sticky top-0 bg-fuchsia-50/95 backdrop-blur-sm px-3 pt-2 pb-1.5">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-sky-100 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">💬</span>
            <h2 className="font-bold text-slate-700 text-sm tracking-wide">Sohbetcan</h2>
          </div>
          <span className="text-base">🧡</span>
        </div>
      </div>

      {/* ── 2. Mesaj listesi — flex-1, kendi scroll'u ── */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 space-y-3"
      >
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-slate-300 font-medium italic text-sm">
            Henüz kimse bir şey yazmamış...
          </div>
        )}

        {messages.map((msg) => (
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
        ))}

        {/* Scroll anchor — en alta kaydırmak için */}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 3. Mesaj yazma kutusu ── */}
      <div className="flex-shrink-0 z-50 bg-fuchsia-50/98 backdrop-blur-md border-t border-slate-200/80">
        <form onSubmit={handleSend} className="px-3 pt-2 pb-3">
          {/* Modern Pill — input + buton tek kapsayıcı içinde */}
          <div className="flex items-center bg-white rounded-full border border-slate-200/80 shadow-md overflow-hidden pl-4 pr-1 py-1 gap-2">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Tatlı bir şeyler yaz..."
              className="flex-1 bg-transparent outline-none text-slate-700 text-[16px] font-medium min-w-0 placeholder:text-slate-300"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="bg-sky-400 hover:bg-sky-500 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 text-white w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all shadow-sm"
            >
              <Send size={18} className="translate-x-0.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
