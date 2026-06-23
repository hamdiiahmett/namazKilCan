import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, onChildChanged, push, serverTimestamp, update } from 'firebase/database';
import { Send, Pencil, Trash2, Flower2, MessageCircleHeart, X, Check } from 'lucide-react';
import { format } from 'date-fns';

// ── Inline keyframe styles (injected once) ──────────────────────────────────────
const animationStyles = `
@keyframes chatBubbleIn {
  0% { opacity: 0; transform: translateY(12px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes slideMenu {
  0% { opacity: 0; transform: translateY(-6px) scale(0.95); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes sendPulse {
  0% { transform: scale(1); }
  50% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
.chat-bubble-enter {
  animation: chatBubbleIn 0.3s ease-out both;
}
.context-menu-enter {
  animation: slideMenu 0.2s ease-out both;
}
.send-pulse {
  animation: sendPulse 0.15s ease-in-out;
}
`;

// ── Style injector (runs once) ──────────────────────────────────────────────────
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = animationStyles;
  document.head.appendChild(style);
}

// ── Edit Overlay ────────────────────────────────────────────────────────────────
// Renders inline when a specific message is being edited.
// Only this component holds edit state references, so other bubbles don't re-render.
const EditOverlay = memo(({ msgId, initialText, onSave, onCancel }) => {
  const [localText, setLocalText] = useState(initialText);
  const inputRef = useRef(null);

  useEffect(() => {
    // Auto-focus with a slight delay for mobile keyboards
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const save = () => {
    if (!localText.trim()) return;
    onSave(msgId, localText.trim());
  };

  return (
    <div className="w-full max-w-[92%] bg-white/95 backdrop-blur-sm p-3.5 rounded-2xl shadow-lg border border-pink-100 flex flex-col gap-2.5 chat-bubble-enter">
      <input
        ref={inputRef}
        value={localText}
        onChange={e => setLocalText(e.target.value)}
        className="w-full bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 text-[16px] outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100/50 transition-all"
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex justify-end gap-2 text-xs font-medium">
        <button
          onClick={onCancel}
          className="px-3.5 py-1.5 text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-all flex items-center gap-1.5 active:scale-95"
        >
          <X size={12} />
          İptal
        </button>
        <button
          onClick={save}
          className="px-3.5 py-1.5 text-white rounded-lg transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #ec4899, #f43f5e)' }}
        >
          <Check size={12} />
          Kaydet
        </button>
      </div>
    </div>
  );
});
EditOverlay.displayName = 'EditOverlay';

// ── Message Bubble ──────────────────────────────────────────────────────────────
// PERF: No longer receives editingId / editText / setEditText / onSaveEdit / setEditingId.
// The parent renders EditOverlay *outside* this component when editing is active,
// so this component never re-renders due to edit-state changes.
const MessageBubble = memo(({
  msg, currentUser,
  activeMenuId, setActiveMenuId,
  onEditClick, onDelete,
}) => {
  const isMe = msg.senderId === currentUser;
  const timeStr = msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : '';

  return (
    <div className={`flex w-full chat-bubble-enter ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>
        {/* ── Message body ── */}
        <div
          onClick={() => {
            if (isMe && !msg.isDeleted)
              setActiveMenuId(activeMenuId === msg.id ? null : msg.id);
          }}
          className={[
            'max-w-[80%] px-3.5 py-2.5 rounded-2xl relative text-[14px] leading-relaxed transition-all duration-200',
            isMe && !msg.isDeleted ? 'cursor-pointer hover:scale-[0.98] active:scale-95' : '',
            isMe
              ? msg.isDeleted
                ? 'bg-pink-50 text-slate-400 italic rounded-tr-sm shadow-sm'
                : 'text-white rounded-tr-sm shadow-md'
              : 'bg-white text-slate-700 border border-pink-100/60 rounded-tl-sm shadow-sm',
          ].join(' ')}
          style={
            isMe && !msg.isDeleted
              ? { background: 'linear-gradient(135deg, #f472b6, #fb7185)' }
              : undefined
          }
        >
          {msg.type === 'image' && !msg.isDeleted ? (
            <div className="mt-0.5 mb-0.5 relative">
              <img
                src={msg.imageUrl} alt="Çizim" loading="lazy"
                className="rounded-xl w-full max-w-[200px] border-2 border-white/30 shadow-sm bg-white"
              />
            </div>
          ) : (
            <div className="break-words">{msg.text}</div>
          )}

          <div className={`flex justify-end items-center gap-1 text-[10px] mt-0.5
            ${isMe ? (msg.isDeleted ? 'text-slate-400' : 'text-pink-100') : 'text-slate-400'}`}>
            {msg.isEdited && !msg.isDeleted && (
              <span className="opacity-80 font-medium italic">(düzenlendi)</span>
            )}
            <span>{timeStr}</span>
          </div>
        </div>

        {/* ── Context Menu ── */}
        {activeMenuId === msg.id && (
          <div className="mt-2 flex gap-2 justify-end mr-1 z-10 context-menu-enter">
            {msg.type !== 'image' && (
              <button
                onClick={() => onEditClick(msg)}
                className="text-xs font-medium bg-white text-slate-600 px-3 py-2 rounded-xl shadow-md border border-slate-100 hover:bg-slate-50 transition-all flex items-center gap-1.5 active:scale-95"
              >
                <Pencil size={12} className="text-pink-400" />
                Düzenle
              </button>
            )}
            <button
              onClick={() => onDelete(msg.id)}
              className="text-xs font-medium bg-white text-red-500 px-3 py-2 rounded-xl shadow-md border border-red-100 hover:bg-red-50 transition-all flex items-center gap-1.5 active:scale-95"
            >
              <Trash2 size={12} />
              Sil
            </button>
          </div>
        )}
      </div>
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
  const [sendAnimating, setSendAnimating] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesMapRef = useRef(new Map());
  const inputRef = useRef(null);

  // Inject CSS animations on mount
  useEffect(() => { injectStyles(); }, []);

  // Auto-scroll logic
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

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

  // Scroll when new messages arrive
  useEffect(() => {
    scrollToBottom('auto');
    const timer = setTimeout(() => scrollToBottom('smooth'), 120);
    return () => clearTimeout(timer);
  }, [messages.length, scrollToBottom]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSend = useCallback((e) => {
    e.preventDefault();
    if (!text.trim()) return;

    // Trigger send button animation
    setSendAnimating(true);
    setTimeout(() => setSendAnimating(false), 200);

    push(ref(rtdb, 'chat/messages'), {
      text: text.trim(),
      senderId: currentUser,
      timestamp: serverTimestamp(),
    });
    setText('');
    setTimeout(() => scrollToBottom('smooth'), 60);
  }, [text, currentUser, scrollToBottom]);

  const handleDelete = useCallback((id) => {
    update(ref(rtdb, `chat/messages/${id}`), { isDeleted: true, text: '🚫 Bu mesaj silindi' });
    setActiveMenuId(null);
  }, []);

  const handleEditClick = useCallback((msg) => {
    setEditingId(msg.id);
    setActiveMenuId(null);
  }, []);

  const handleSaveEdit = useCallback((id, newText) => {
    if (!newText.trim()) return;
    update(ref(rtdb, `chat/messages/${id}`), { text: newText.trim(), isEdited: true });
    setEditingId(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  // Find the message being edited (for the EditOverlay)
  const editingMsg = useMemo(() => {
    if (!editingId) return null;
    return messages.find(m => m.id === editingId) || null;
  }, [editingId, messages]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-pink-50/40 via-slate-50 to-white relative overflow-hidden">

      {/* ── 1. Header (Sohbetcan) ── */}
      <div className="flex-shrink-0 z-10 sticky top-0 border-b border-pink-100/50"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(253,242,248,0.92))', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      >
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
              style={{ background: 'linear-gradient(135deg, #f9a8d4, #fb7185)' }}>
              <Flower2 size={18} className="text-white" />
            </div>
            <div className="flex flex-col">
              <h2 className="font-bold text-slate-700 text-[15px] leading-tight tracking-tight">Sohbetcan</h2>
              <span className="text-[10px] text-pink-400 font-medium">VOOOOOOOOOOO🧡</span>
            </div>
          </div>
          <div className="flex -space-x-2">
            <div className="w-7 h-7 rounded-full bg-sky-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-sky-600 shadow-sm">Z</div>
            <div className="w-7 h-7 rounded-full bg-pink-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-pink-600 shadow-sm">A</div>
          </div>
        </div>
      </div>

      {/* ── 2. Messages Area ── */}
      <div className="flex-1 overflow-y-auto flex flex-col p-4 space-y-3 overscroll-contain">
        {/* Spacer: pushes messages to bottom when few */}
        <div className="flex-1 min-h-[20px]" />

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #fce7f3, #ffe4e6)' }}>
              <MessageCircleHeart size={28} className="text-pink-300" />
            </div>
            <p className="text-sm font-medium text-slate-400">Henüz mesaj yok.</p>
            <p className="text-xs text-slate-300 mt-1">İlk selamı sen ver! 🌸</p>
          </div>
        ) : (
          messages.map((msg) => (
            editingId === msg.id ? (
              // PERF: Only the editing message gets the EditOverlay.
              // Other MessageBubble instances never see edit-state props.
              <div key={msg.id} className={`flex w-full ${msg.senderId === currentUser ? 'justify-end' : 'justify-start'}`}>
                <EditOverlay
                  msgId={msg.id}
                  initialText={msg.text}
                  onSave={handleSaveEdit}
                  onCancel={handleCancelEdit}
                />
              </div>
            ) : (
              <MessageBubble
                key={msg.id}
                msg={msg}
                currentUser={currentUser}
                activeMenuId={activeMenuId}
                setActiveMenuId={setActiveMenuId}
                onEditClick={handleEditClick}
                onDelete={handleDelete}
              />
            )
          ))
        )}

        {/* Auto-scroll Anchor */}
        <div ref={messagesEndRef} className="h-0 w-0" />
      </div>

      {/* ── 3. Input Area ── */}
      <div className="flex-shrink-0 bg-white/95 border-t border-pink-100/50"
        style={{
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        }}
      >
        <form onSubmit={handleSend} className="max-w-[500px] mx-auto p-3">
          <div className="flex items-center bg-slate-50/80 rounded-[24px] border border-slate-200/50 shadow-inner px-1.5 py-1.5 gap-2 group transition-all duration-300 focus-within:bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100/50 focus-within:shadow-md">
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Tatlı Mesajlar Yazın ..."
              enterKeyHint="send"
              className="flex-1 bg-transparent border-none focus:ring-0 outline-none px-4 text-slate-700 text-[16px] font-medium min-w-0 placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className={[
                'w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all duration-200 shadow-md',
                'disabled:shadow-none disabled:opacity-40',
                sendAnimating ? 'send-pulse' : '',
              ].join(' ')}
              style={{
                background: text.trim()
                  ? 'linear-gradient(135deg, #ec4899, #f43f5e)'
                  : '#cbd5e1',
              }}
            >
              <Send size={18} className="text-white translate-x-0.5" />
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
