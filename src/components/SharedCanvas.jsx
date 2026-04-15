import React, { useRef, useEffect, useState, useCallback } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, push, set, serverTimestamp } from 'firebase/database';
import { Trash2, Eraser, Undo2, Send, Maximize, X } from 'lucide-react';

export default function SharedCanvas({ currentUser }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#fb7185');
  const [isEraser, setIsEraser] = useState(false);
  const [history, setHistory] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const colorRef = useRef(color);
  const isEraserRef = useRef(isEraser);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const isDrawingRef = useRef(false);

  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { isEraserRef.current = isEraser; }, [isEraser]);

  const currentStrokeIdRef = useRef('');
  const allSegmentsRef = useRef([]);
  const undoneStrokesRef = useRef(new Set());

  // Throttle: Firebase'e max 30 kez/sn gönder (≈33ms aralık)
  const lastPushTimeRef = useRef(0);
  const pendingSegRef = useRef(null);
  const pushTimerRef = useRef(null);

  const colors = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#475569'];

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, []);

  const drawSegment = useCallback((ctx, seg) => {
    if (seg.clear || seg.undo) return;
    ctx.globalCompositeOperation = seg.isEraser ? 'destination-out' : 'source-over';
    ctx.lineWidth = seg.isEraser ? seg.width * 5 : seg.width;
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.strokeStyle = seg.isEraser ? 'rgba(0,0,0,1)' : seg.color;
    ctx.stroke();
    ctx.closePath();
  }, []);

  // Segment'i throttle ederek Firebase'e gönder
  const pushSegment = useCallback((seg) => {
    const now = Date.now();
    const elapsed = now - lastPushTimeRef.current;

    if (elapsed >= 33) {
      // Doğrudan gönder
      lastPushTimeRef.current = now;
      push(ref(rtdb, 'canvas/segments'), seg);
      pendingSegRef.current = null;
    } else {
      // Beklet, en güncel segmenti sakla
      pendingSegRef.current = seg;
      if (!pushTimerRef.current) {
        pushTimerRef.current = setTimeout(() => {
          pushTimerRef.current = null;
          if (pendingSegRef.current) {
            push(ref(rtdb, 'canvas/segments'), pendingSegRef.current);
            lastPushTimeRef.current = Date.now();
            pendingSegRef.current = null;
          }
        }, 33 - elapsed);
      }
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });

    canvas.width = 500;
    canvas.height = 300;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const segmentsRef = ref(rtdb, 'canvas/segments');
    const unsubscribe = onChildAdded(segmentsRef, (snapshot) => {
      const seg = snapshot.val();
      if (!seg) return;

      if (seg.clear) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        allSegmentsRef.current = [];
        undoneStrokesRef.current = new Set();
        return;
      }

      if (seg.undo) {
        undoneStrokesRef.current.add(seg.strokeId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Sadece aktif stroke'ları çiz
        for (const s of allSegmentsRef.current) {
          if (!undoneStrokesRef.current.has(s.strokeId)) {
            drawSegment(ctx, s);
          }
        }
        return;
      }

      allSegmentsRef.current.push(seg);
      if (!undoneStrokesRef.current.has(seg.strokeId)) {
        drawSegment(ctx, seg);
      }
    });

    return () => {
      unsubscribe();
      // Bekleyen timer'ı temizle
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [drawSegment]);

  const startDraw = useCallback((e) => {
    isDrawingRef.current = true;
    setIsDrawing(true);
    const pos = getPos(e);
    lastPosRef.current = pos;
    const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    currentStrokeIdRef.current = strokeId;
    setHistory(prev => [...prev, strokeId]);
  }, [getPos]);

  useEffect(() => {
    if (!isDrawing) return;

    const handleMove = (e) => {
      if (e.cancelable && e.type === 'touchmove') {
        e.preventDefault();
      }

      const currentPos = getPos(e);
      const lp = lastPosRef.current;

      // Lokalda anlık çiz (gecikme olmadan)
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const seg = {
          strokeId: currentStrokeIdRef.current,
          x0: lp.x, y0: lp.y,
          x1: currentPos.x, y1: currentPos.y,
          color: colorRef.current,
          width: 4,
          isEraser: isEraserRef.current
        };

        // Lokal çizim anlık
        drawSegment(ctx, seg);

        // Firebase'e throttle ile gönder
        pushSegment(seg);
      }

      lastPosRef.current = currentPos;
    };

    const handleEnd = () => {
      isDrawingRef.current = false;
      setIsDrawing(false);
      // Bekleyen son segmenti gönder
      if (pendingSegRef.current) {
        push(ref(rtdb, 'canvas/segments'), pendingSegRef.current);
        pendingSegRef.current = null;
        if (pushTimerRef.current) {
          clearTimeout(pushTimerRef.current);
          pushTimerRef.current = null;
        }
      }
    };

    window.addEventListener('mousemove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isDrawing, getPos, drawSegment, pushSegment]);

  const clearCanvas = useCallback(() => {
    setHistory([]);
    allSegmentsRef.current = [];
    undoneStrokesRef.current = new Set();
    set(ref(rtdb, 'canvas/segments'), null);
    push(ref(rtdb, 'canvas/segments'), { clear: true });
  }, []);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const lastStrokeId = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    push(ref(rtdb, 'canvas/segments'), { undo: true, strokeId: lastStrokeId });
  }, [history]);

  const handleSendToChat = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    // JPEG + düşük kalite = çok daha küçük boyut (PNG'ye göre %70-80 küçük)
    const base64Image = tempCanvas.toDataURL('image/jpeg', 0.6);
    push(ref(rtdb, 'chat/messages'), {
      type: 'image',
      imageUrl: base64Image,
      senderId: currentUser || 'Anonim',
      timestamp: serverTimestamp()
    });
  }, [currentUser]);

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-md p-4 sm:p-8 overflow-y-auto' : 'bg-white/80 backdrop-blur-sm rounded-[2rem] shadow-sm border border-purple-100/50 p-6'} flex flex-col items-center transition-all duration-300`}>
      <div className={`w-full ${isFullscreen ? 'max-w-5xl my-auto' : ''}`}>
        <div className="w-full flex justify-between items-center mb-4">
          <h2 className={`font-bold ${isFullscreen ? 'text-white' : 'text-slate-700'}`}>Çizim Tahtamız 🎨</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className={`p-2 rounded-full transition-colors shadow-sm ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              title={isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
            >
              {isFullscreen ? <X size={18} /> : <Maximize size={18} />}
            </button>
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              className={`p-2 rounded-full transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              title="Geri Al"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={clearCanvas}
              className={`p-2 rounded-full transition-colors shadow-sm ${isFullscreen ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'bg-purple-50 text-purple-500 hover:bg-purple-100'}`}
              title="Tümünü Temizle"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        <div className={`w-full border-2 ${isFullscreen ? 'border-slate-700 bg-slate-800 shadow-2xl' : 'border-dashed border-slate-200 bg-slate-50 shadow-inner'} rounded-2xl overflow-hidden mb-5 touch-none relative`}>
          <canvas
            ref={canvasRef}
            onMouseDown={startDraw}
            onTouchStart={startDraw}
            className="w-full aspect-[5/3] cursor-crosshair bg-white block"
          />
        </div>

        <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className={`flex justify-center flex-wrap gap-2 sm:gap-3 px-4 py-2 rounded-full shadow-sm items-center w-full sm:w-auto ${isFullscreen ? 'bg-slate-800/80' : 'bg-white'}`}>
            {colors.map(c => (
              <button
                key={c}
                onClick={() => { setColor(c); setIsEraser(false); }}
                className={`w-8 h-8 rounded-full border-2 transition-transform shadow-sm flex-shrink-0 ${!isEraser && color === c ? 'scale-125 border-slate-300 shadow-md' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}

            <div className={`relative w-8 h-8 rounded-full border-2 transition-transform shadow-sm flex-shrink-0 overflow-hidden cursor-pointer ${!isEraser && !colors.includes(color) ? 'scale-125 border-slate-300 shadow-md' : 'border-transparent'}`}
              style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
              title="Özel Renk Seç"
            >
              <input
                type="color"
                value={colors.includes(color) ? '#000000' : color}
                onChange={(e) => { setColor(e.target.value); setIsEraser(false); }}
                className="absolute inset-0 w-[150%] h-[150%] top-[-25%] left-[-25%] opacity-0 cursor-pointer"
              />
            </div>

            <div className={`w-[2px] h-6 mx-1 rounded-full hidden sm:block ${isFullscreen ? 'bg-slate-700' : 'bg-slate-200'}`}></div>

            <button
              onClick={() => setIsEraser(true)}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-all shadow-sm flex-shrink-0 ${isEraser ? (isFullscreen ? 'bg-white text-slate-900 shadow-md scale-125' : 'bg-slate-800 text-white shadow-md scale-125') : (isFullscreen ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}`}
              title="Silgi"
            >
              <Eraser size={16} />
            </button>
          </div>

          <button
            onClick={handleSendToChat}
            className="flex items-center justify-center gap-2 bg-pink-500 hover:bg-pink-600 text-white px-5 py-2.5 rounded-full shadow-sm transition-all font-medium w-full sm:w-auto"
          >
            <span>Sohbete Gönder</span>
            <Send size={16} className="translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
