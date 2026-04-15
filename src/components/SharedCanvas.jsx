import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, push, set, serverTimestamp } from 'firebase/database';
import { Trash2, Eraser, Undo2, Send, Maximize, X } from 'lucide-react';

// ─── Yardımcı: Douglas-Peucker Path Simplification ───────────────────────────
function perpendicularDist(pt, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  }
  const t = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / (dx * dx + dy * dy);
  return Math.hypot(pt.x - (lineStart.x + t * dx), pt.y - (lineStart.y + t * dy));
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

// Stroke noktalarını Firebase segmentlerine dönüştür (simplify sonrası)
function strokeToSegments(points, strokeId, color, isEraser, width) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({
      strokeId,
      x0: points[i].x,   y0: points[i].y,
      x1: points[i + 1].x, y1: points[i + 1].y,
      color, width, isEraser,
    });
  }
  return segs;
}

// ─── Snapshot eşiği ──────────────────────────────────────────────────────────
const SNAPSHOT_THRESHOLD = 300; // Bu kadar segment birikince snapshot al

// ─── Ana bileşen (memo ile sarılmış) ─────────────────────────────────────────
const SharedCanvas = memo(function SharedCanvas({ currentUser }) {
  const canvasRef      = useRef(null);
  const [isDrawing,    setIsDrawing]    = useState(false);
  const [color,        setColor]        = useState('#fb7185');
  const [isEraser,     setIsEraser]     = useState(false);
  const [history,      setHistory]      = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [segmentCount, setSegmentCount] = useState(0); // UI göstergesi için

  const colorRef      = useRef(color);
  const isEraserRef   = useRef(isEraser);
  const lastPosRef    = useRef({ x: 0, y: 0 });
  const isDrawingRef  = useRef(false);

  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { isEraserRef.current = isEraser; }, [isEraser]);

  const currentStrokeIdRef  = useRef('');
  const currentStrokePtsRef = useRef([]); // Aktif stroke nokta tamponu
  const allSegmentsRef      = useRef([]);
  const undoneStrokesRef    = useRef(new Set());

  // Throttle: Firebase'e ~30fps gönder
  const lastPushTimeRef  = useRef(0);
  const pendingSegRef    = useRef(null);
  const pushTimerRef     = useRef(null);

  // RAF animasyon kaynağı
  const rafRef = useRef(null);

  const colors = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#475569'];

  // ── Pozisyon hesapla ──────────────────────────────────────────────────────
  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect   = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width  / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
  }, []);

  // ── Tek segment çiz (off-screen: canvas'ı baştan sona silmeden) ───────────
  const drawSegment = useCallback((ctx, seg) => {
    if (seg.clear || seg.undo || seg.snapshot) return;
    ctx.globalCompositeOperation = seg.isEraser ? 'destination-out' : 'source-over';
    ctx.lineWidth   = seg.isEraser ? (seg.width * 5) : seg.width;
    ctx.strokeStyle = seg.isEraser ? 'rgba(0,0,0,1)' : seg.color;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
    ctx.closePath();
  }, []);

  // ── Tüm segmentleri yeniden çiz (sadece undo/clear sonrası gerekli) ───────
  const redrawAll = useCallback((ctx, canvas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of allSegmentsRef.current) {
      if (!undoneStrokesRef.current.has(s.strokeId)) {
        drawSegment(ctx, s);
      }
    }
  }, [drawSegment]);

  // ── Firebase push (throttled) ─────────────────────────────────────────────
  const pushSegment = useCallback((seg) => {
    const now     = Date.now();
    const elapsed = now - lastPushTimeRef.current;

    if (elapsed >= 33) {
      lastPushTimeRef.current = now;
      push(ref(rtdb, 'canvas/segments'), seg);
      pendingSegRef.current = null;
    } else {
      pendingSegRef.current = seg;
      if (!pushTimerRef.current) {
        pushTimerRef.current = setTimeout(() => {
          pushTimerRef.current = null;
          if (pendingSegRef.current) {
            push(ref(rtdb, 'canvas/segments'), pendingSegRef.current);
            lastPushTimeRef.current = Date.now();
            pendingSegRef.current   = null;
          }
        }, 33 - elapsed);
      }
    }
  }, []);

  // ── Snapshot: çok segment birikince Base64'e dönüştür ve temizle ──────────
  const takeSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Beyaz arka planlı geçici canvas
    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
    const tCtx = tmp.getContext('2d');
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, tmp.width, tmp.height);
    tCtx.drawImage(canvas, 0, 0);
    const dataUrl = tmp.toDataURL('image/jpeg', 0.75);

    // Firebase'i temizle, snapshot'ı yükle
    set(ref(rtdb, 'canvas/segments'), null).then(() => {
      push(ref(rtdb, 'canvas/segments'), {
        snapshot: true,
        imageData: dataUrl,
        timestamp: Date.now(),
      });
    });

    // Local state sıfırla
    allSegmentsRef.current    = [];
    undoneStrokesRef.current  = new Set();
    setHistory([]);
    setSegmentCount(0);
  }, []);

  // ── Firebase listener ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });

    canvas.width  = 500;
    canvas.height = 300;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';

    const segmentsRef  = ref(rtdb, 'canvas/segments');
    const unsubscribe  = onChildAdded(segmentsRef, (snapshot) => {
      const seg = snapshot.val();
      if (!seg) return;

      // ── Snapshot geldi: resmi canvas'a bas, local listeyi temizle ──
      if (seg.snapshot) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = seg.imageData;
        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        setSegmentCount(0);
        return;
      }

      // ── Clear ──
      if (seg.clear) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        allSegmentsRef.current    = [];
        undoneStrokesRef.current  = new Set();
        setSegmentCount(0);
        return;
      }

      // ── Undo ──
      if (seg.undo) {
        undoneStrokesRef.current.add(seg.strokeId);
        redrawAll(ctx, canvas);
        return;
      }

      // ── Normal segment ──
      allSegmentsRef.current.push(seg);
      const newCount = allSegmentsRef.current.length;
      setSegmentCount(newCount);

      if (!undoneStrokesRef.current.has(seg.strokeId)) {
        // OFF-SCREEN RENDERING: canvas'ı silmeden sadece yeni segmenti ekle
        drawSegment(ctx, seg);
      }
    });

    return () => {
      unsubscribe();
      if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); }
    };
  }, [drawSegment, redrawAll]);

  // ── Çizim başlat ──────────────────────────────────────────────────────────
  const startDraw = useCallback((e) => {
    isDrawingRef.current   = true;
    setIsDrawing(true);
    const pos              = getPos(e);
    lastPosRef.current     = pos;
    currentStrokePtsRef.current = [pos]; // Nokta tamponunu başlat
    const strokeId         = Date.now().toString(36) + Math.random().toString(36).slice(2);
    currentStrokeIdRef.current = strokeId;
    setHistory(prev => [...prev, strokeId]);
  }, [getPos]);

  // ── Çizim hareketi (throttled move + local instant draw) ──────────────────
  useEffect(() => {
    if (!isDrawing) return;

    let lastThrottleTime = 0;

    const handleMove = (e) => {
      if (e.cancelable && e.type === 'touchmove') e.preventDefault();

      const now        = performance.now();
      const currentPos = getPos(e);

      // ── Lokal anlık çizim (RAF ile birleştir) ──
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const lp  = lastPosRef.current;
        const seg = {
          strokeId: currentStrokeIdRef.current,
          x0: lp.x, y0: lp.y,
          x1: currentPos.x, y1: currentPos.y,
          color: colorRef.current,
          width: 4,
          isEraser: isEraserRef.current,
        };
        drawSegment(ctx, seg); // Sadece yeni segmenti ekle (off-screen)
      });

      // Nokta tamponuna ekle
      currentStrokePtsRef.current.push(currentPos);

      // ── Firebase'e throttle (~30fps = ~33ms) ──
      if (now - lastThrottleTime >= 33) {
        lastThrottleTime = now;
        const lp = lastPosRef.current;
        const seg = {
          strokeId: currentStrokeIdRef.current,
          x0: lp.x, y0: lp.y,
          x1: currentPos.x, y1: currentPos.y,
          color: colorRef.current,
          width: 4,
          isEraser: isEraserRef.current,
        };
        pushSegment(seg);
      }

      lastPosRef.current = currentPos;
    };

    const handleEnd = () => {
      isDrawingRef.current = false;
      setIsDrawing(false);

      // Stroke bitti: PATH SİMPLİFİCATION uygula, son noktaları gönder
      const pts = currentStrokePtsRef.current;
      if (pts.length >= 2) {
        const simplified = douglasPeucker(pts, 2.0); // 2px tolerans
        const segs       = strokeToSegments(
          simplified,
          currentStrokeIdRef.current,
          colorRef.current,
          isEraserRef.current,
          4
        );
        // Sadeleştirilmiş son segmentleri gönder (throttle bypass: son veri önemli)
        segs.forEach(s => push(ref(rtdb, 'canvas/segments'), s));
      } else if (pendingSegRef.current) {
        push(ref(rtdb, 'canvas/segments'), pendingSegRef.current);
      }

      pendingSegRef.current = null;
      if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); pushTimerRef.current = null; }
      currentStrokePtsRef.current = [];
    };

    window.addEventListener('mousemove',   handleMove,  { passive: false });
    window.addEventListener('mouseup',     handleEnd);
    window.addEventListener('touchmove',   handleMove,  { passive: false });
    window.addEventListener('touchend',    handleEnd);
    window.addEventListener('touchcancel', handleEnd);

    return () => {
      window.removeEventListener('mousemove',   handleMove);
      window.removeEventListener('mouseup',     handleEnd);
      window.removeEventListener('touchmove',   handleMove);
      window.removeEventListener('touchend',    handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isDrawing, getPos, drawSegment, pushSegment]);

  // ── Temizle ───────────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    setHistory([]);
    allSegmentsRef.current   = [];
    undoneStrokesRef.current = new Set();
    setSegmentCount(0);
    set(ref(rtdb, 'canvas/segments'), null);
    push(ref(rtdb, 'canvas/segments'), { clear: true });
  }, []);

  // ── Geri Al ───────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const lastStrokeId = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    push(ref(rtdb, 'canvas/segments'), { undo: true, strokeId: lastStrokeId });
  }, [history]);

  // ── Sohbete Gönder ────────────────────────────────────────────────────────
  const handleSendToChat = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tmp    = document.createElement('canvas');
    tmp.width    = canvas.width;
    tmp.height   = canvas.height;
    const ctx    = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0);
    const base64 = tmp.toDataURL('image/jpeg', 0.6);
    push(ref(rtdb, 'chat/messages'), {
      type:      'image',
      imageUrl:  base64,
      senderId:  currentUser || 'Anonim',
      timestamp: serverTimestamp(),
    });
  }, [currentUser]);

  // ── Otomatik snapshot tetikle ─────────────────────────────────────────────
  useEffect(() => {
    if (segmentCount >= SNAPSHOT_THRESHOLD) {
      takeSnapshot();
    }
  }, [segmentCount, takeSnapshot]);

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-md p-4 sm:p-8 overflow-y-auto' : 'bg-white/80 backdrop-blur-sm rounded-[2rem] shadow-sm border border-purple-100/50 p-6'} flex flex-col items-center transition-all duration-300`}>
      <div className={`w-full ${isFullscreen ? 'max-w-5xl my-auto' : ''}`}>
        <div className="w-full flex justify-between items-center mb-4">
          <h2 className={`font-bold ${isFullscreen ? 'text-white' : 'text-slate-700'}`}>
            Çizim Tahtamız 🎨
            {segmentCount > SNAPSHOT_THRESHOLD * 0.8 && (
              <span className="ml-2 text-xs font-normal text-amber-400 animate-pulse">
                ({segmentCount} seg)
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className={`p-2 rounded-full transition-colors shadow-sm ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
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
              onClick={takeSnapshot}
              className={`p-2 rounded-full transition-colors shadow-sm text-xs font-bold ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              title="Veriyi Sıkıştır (Snapshot)"
            >
              📷
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

            <div
              className={`relative w-8 h-8 rounded-full border-2 transition-transform shadow-sm flex-shrink-0 overflow-hidden cursor-pointer ${!isEraser && !colors.includes(color) ? 'scale-125 border-slate-300 shadow-md' : 'border-transparent'}`}
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
});

export default SharedCanvas;
