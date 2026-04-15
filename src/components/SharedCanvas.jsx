import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, push, set, serverTimestamp } from 'firebase/database';
import { Trash2, Eraser, Undo2, Send, Maximize, X, PaintBucket } from 'lucide-react';

// ─── Douglas-Peucker path simplification ─────────────────────────────────────
function perpendicularDist(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy);
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > tol) {
    const l = douglasPeucker(pts.slice(0, maxI + 1), tol);
    const r = douglasPeucker(pts.slice(maxI), tol);
    return [...l.slice(0, -1), ...r];
  }
  return [pts[0], pts[pts.length - 1]];
}

// ─── Hex → [r,g,b] ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ─── Flood Fill ───────────────────────────────────────────────────────────────
function runFloodFill(ctx, canvas, sx, sy, fillHex, tolerance = 32) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  const W = canvas.width, H = canvas.height;
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return false;

  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;
  const si = (sy * W + sx) * 4;
  const [sr, sg, sb, sa] = [d[si], d[si + 1], d[si + 2], d[si + 3]];
  const [fr, fg, fb] = hexToRgb(fillHex);
  if (sr === fr && sg === fg && sb === fb && sa === 255) return false;

  const match = i =>
    Math.abs(d[i]     - sr) <= tolerance &&
    Math.abs(d[i + 1] - sg) <= tolerance &&
    Math.abs(d[i + 2] - sb) <= tolerance &&
    Math.abs(d[i + 3] - sa) <= tolerance;

  const visited = new Uint8Array(W * H);
  const stack = [sy * W + sx];

  while (stack.length > 0) {
    const lin = stack.pop();
    if (visited[lin]) continue;
    visited[lin] = 1;
    const pi = lin * 4;
    if (!match(pi)) continue;
    d[pi] = fr; d[pi + 1] = fg; d[pi + 2] = fb; d[pi + 3] = 255;
    const x = lin % W, y = (lin / W) | 0;
    if (x + 1 < W)  stack.push(lin + 1);
    if (x - 1 >= 0) stack.push(lin - 1);
    if (y + 1 < H)  stack.push(lin + W);
    if (y - 1 >= 0) stack.push(lin - W);
  }

  ctx.putImageData(imageData, 0, 0);
  return true;
}

// ─── Bileşen ──────────────────────────────────────────────────────────────────
const SharedCanvas = memo(function SharedCanvas({ currentUser }) {
  const canvasRef = useRef(null);

  const [isDrawing,    setIsDrawing]    = useState(false);
  const [color,        setColor]        = useState('#fb7185');
  const [isEraser,     setIsEraser]     = useState(false);
  const [isFill,       setIsFill]       = useState(false);
  const [brushSize,    setBrushSize]    = useState(4);
  const [history,      setHistory]      = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refs to always have fresh values in event handlers
  const colorRef      = useRef(color);
  const isEraserRef   = useRef(isEraser);
  const isFillRef     = useRef(isFill);
  const brushSizeRef  = useRef(brushSize);
  const lastPosRef    = useRef({ x: 0, y: 0 });
  const isDrawingRef  = useRef(false);

  useEffect(() => { colorRef.current     = color; },     [color]);
  useEffect(() => { isEraserRef.current  = isEraser; },  [isEraser]);
  useEffect(() => { isFillRef.current    = isFill; },    [isFill]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  const currentStrokeIdRef  = useRef('');
  const currentStrokePtsRef = useRef([]);
  const allSegmentsRef      = useRef([]);
  const undoneStrokesRef    = useRef(new Set());
  const lastFillStrokeRef   = useRef(null); // Skip our own fill echo

  // Throttle refs
  const lastPushTimeRef = useRef(0);
  const pendingSegRef   = useRef(null);
  const pushTimerRef    = useRef(null);
  const rafRef          = useRef(null);

  const colors = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#475569'];

  // ── Pozisyon ─────────────────────────────────────────────────────────────
  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (cx - rect.left) * (canvas.width  / rect.width),
      y: (cy - rect.top)  * (canvas.height / rect.height),
    };
  }, []);

  // ── Segment çiz (off-screen — canvas'ı sıfırlamadan yeni segmenti ekle) ──
  const drawSegment = useCallback((ctx, seg) => {
    if (seg.clear || seg.undo || seg.fillCanvas) return;
    ctx.globalCompositeOperation = seg.isEraser ? 'destination-out' : 'source-over';
    ctx.lineWidth   = seg.isEraser ? (seg.width ?? 4) * 4 : (seg.width ?? 4);
    ctx.strokeStyle = seg.isEraser ? 'rgba(0,0,0,1)' : seg.color;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
    ctx.closePath();
  }, []);

  // ── Tüm segmentleri yeniden çiz (sadece undo sonrası) ────────────────────
  const redrawAll = useCallback((ctx, canvas) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of allSegmentsRef.current) {
      if (!undoneStrokesRef.current.has(s.strokeId)) {
        drawSegment(ctx, s);
      }
    }
  }, [drawSegment]);

  // ── Firebase throttled push ───────────────────────────────────────────────
  const pushSegment = useCallback((seg) => {
    const now = Date.now();
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

  // ── Firebase listener ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // willReadFrequently: flood fill için getImageData optimizasyonu
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    canvas.width  = 500;
    canvas.height = 300;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    // Beyaz arka plan (flood fill için gerekli)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const segRef      = ref(rtdb, 'canvas/segments');
    const unsubscribe = onChildAdded(segRef, (snapshot) => {
      const seg = snapshot.val();
      if (!seg) return;

      // Flood fill canvas snapshot
      if (seg.fillCanvas) {
        // Kendi push'umuzun echo'sunu atla (zaten lokalda çizdik)
        if (seg.strokeId === lastFillStrokeRef.current) {
          lastFillStrokeRef.current = null;
          allSegmentsRef.current    = [];
          undoneStrokesRef.current  = new Set();
          setHistory([]);
          return;
        }
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = seg.imageData;
        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        setHistory([]);
        return;
      }

      if (seg.clear) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        return;
      }

      if (seg.undo) {
        undoneStrokesRef.current.add(seg.strokeId);
        redrawAll(ctx, canvas);
        return;
      }

      allSegmentsRef.current.push(seg);
      if (!undoneStrokesRef.current.has(seg.strokeId)) {
        drawSegment(ctx, seg); // Off-screen: sadece yeni segmenti ekle
      }
    });

    return () => {
      unsubscribe();
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [drawSegment, redrawAll]);

  // ── Çizim başlat ─────────────────────────────────────────────────────────
  const startDraw = useCallback((e) => {
    isDrawingRef.current = true;
    setIsDrawing(true);
    const pos = getPos(e);
    lastPosRef.current = pos;
    currentStrokePtsRef.current = [pos];
    const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    currentStrokeIdRef.current = strokeId;
    setHistory(prev => [...prev, strokeId]);
  }, [getPos]);

  // ── Canvas tıklama: Fill veya Çizim ──────────────────────────────────────
  const handleCanvasMouseDown = useCallback((e) => {
    if (isFillRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pos = getPos(e);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const filled = runFloodFill(ctx, canvas, pos.x, pos.y, colorRef.current);
      if (filled) {
        const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        lastFillStrokeRef.current = strokeId;

        // Canvas'ı JPEG'e çevir ve Firebase'e gönder
        const tmp = document.createElement('canvas');
        tmp.width  = canvas.width;
        tmp.height = canvas.height;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
        const dataUrl = tmp.toDataURL('image/jpeg', 0.8);

        push(ref(rtdb, 'canvas/segments'), { fillCanvas: true, imageData: dataUrl, strokeId });
        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        setHistory([]);
      }
    } else {
      startDraw(e);
    }
  }, [getPos, startDraw]);

  // ── Move & End handlers (attach when drawing) ─────────────────────────────
  useEffect(() => {
    if (!isDrawing) return;

    let lastThrottleTime = 0;

    const handleMove = (e) => {
      if (e.cancelable && e.type === 'touchmove') e.preventDefault();

      const now        = performance.now();
      const currentPos = getPos(e);

      // Lokal çizim: RAF ile (smooth)
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const lp  = lastPosRef.current;
        drawSegment(ctx, {
          strokeId: currentStrokeIdRef.current,
          x0: lp.x, y0: lp.y,
          x1: currentPos.x, y1: currentPos.y,
          color:    colorRef.current,
          width:    brushSizeRef.current,
          isEraser: isEraserRef.current,
        });
      });

      currentStrokePtsRef.current.push(currentPos);

      // Firebase'e throttle (30fps)
      if (now - lastThrottleTime >= 33) {
        lastThrottleTime = now;
        const lp = lastPosRef.current;
        pushSegment({
          strokeId: currentStrokeIdRef.current,
          x0: lp.x, y0: lp.y,
          x1: currentPos.x, y1: currentPos.y,
          color:    colorRef.current,
          width:    brushSizeRef.current,
          isEraser: isEraserRef.current,
        });
      }

      lastPosRef.current = currentPos;
    };

    const handleEnd = () => {
      isDrawingRef.current = false;
      setIsDrawing(false);

      // Stroke bitti: Douglas-Peucker ile sadeleştir, son segmentleri gönder
      const pts = currentStrokePtsRef.current;
      if (pts.length >= 2) {
        const simplified = douglasPeucker(pts, 2.0);
        for (let i = 0; i < simplified.length - 1; i++) {
          push(ref(rtdb, 'canvas/segments'), {
            strokeId: currentStrokeIdRef.current,
            x0: simplified[i].x,     y0: simplified[i].y,
            x1: simplified[i+1].x,   y1: simplified[i+1].y,
            color:    colorRef.current,
            width:    brushSizeRef.current,
            isEraser: isEraserRef.current,
          });
        }
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
    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
    const tCtx = tmp.getContext('2d');
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, tmp.width, tmp.height);
    tCtx.drawImage(canvas, 0, 0);
    push(ref(rtdb, 'chat/messages'), {
      type:      'image',
      imageUrl:  tmp.toDataURL('image/jpeg', 0.6),
      senderId:  currentUser || 'Anonim',
      timestamp: serverTimestamp(),
    });
  }, [currentUser]);

  // ── Aktif araç yardımcıları ───────────────────────────────────────────────
  const activeTool = isFill ? 'fill' : isEraser ? 'eraser' : 'pen';
  const canvasCursor = isFill ? 'cursor-cell' : 'cursor-crosshair';

  const btnBase = (active, fs) =>
    `flex items-center justify-center w-8 h-8 rounded-full transition-all shadow-sm flex-shrink-0 ${
      active
        ? fs ? 'bg-white text-slate-900 shadow-md scale-125' : 'bg-slate-800 text-white shadow-md scale-125'
        : fs ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
    }`;

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-md p-4 sm:p-8 overflow-y-auto' : 'bg-white/80 backdrop-blur-sm rounded-[2rem] shadow-sm border border-purple-100/50 p-6'} flex flex-col items-center transition-all duration-300`}>
      <div className={`w-full ${isFullscreen ? 'max-w-5xl my-auto' : ''}`}>

        {/* Başlık + Araç Butonları */}
        <div className="w-full flex justify-between items-center mb-4">
          <h2 className={`font-bold ${isFullscreen ? 'text-white' : 'text-slate-700'}`}>
            Çizim Tahtamız 🎨
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
              onClick={clearCanvas}
              className={`p-2 rounded-full transition-colors shadow-sm ${isFullscreen ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'bg-purple-50 text-purple-500 hover:bg-purple-100'}`}
              title="Tümünü Temizle"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className={`w-full border-2 ${isFullscreen ? 'border-slate-700 bg-slate-800 shadow-2xl' : 'border-dashed border-slate-200 bg-slate-50 shadow-inner'} rounded-2xl overflow-hidden mb-4 touch-none relative`}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onTouchStart={handleCanvasMouseDown}
            className={`w-full aspect-[5/3] ${canvasCursor} bg-white block`}
          />
        </div>

        {/* Alt Araç Çubuğu */}
        <div className="w-full flex flex-col gap-3">

          {/* Renk + Araç Butonları */}
          <div className={`flex justify-center flex-wrap gap-2 px-4 py-2 rounded-full shadow-sm items-center w-full ${isFullscreen ? 'bg-slate-800/80' : 'bg-white'}`}>
            {colors.map(c => (
              <button
                key={c}
                onClick={() => { setColor(c); setIsEraser(false); setIsFill(false); }}
                className={`w-8 h-8 rounded-full border-2 transition-transform shadow-sm flex-shrink-0 ${!isEraser && !isFill && color === c ? 'scale-125 border-slate-300 shadow-md' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}

            {/* Özel Renk */}
            <div
              className={`relative w-8 h-8 rounded-full border-2 transition-transform shadow-sm flex-shrink-0 overflow-hidden cursor-pointer ${!isEraser && !isFill && !colors.includes(color) ? 'scale-125 border-slate-300 shadow-md' : 'border-transparent'}`}
              style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
              title="Özel Renk Seç"
            >
              <input
                type="color"
                value={colors.includes(color) ? '#000000' : color}
                onChange={(e) => { setColor(e.target.value); setIsEraser(false); setIsFill(false); }}
                className="absolute inset-0 w-[150%] h-[150%] top-[-25%] left-[-25%] opacity-0 cursor-pointer"
              />
            </div>

            <div className={`w-[2px] h-6 mx-1 rounded-full hidden sm:block ${isFullscreen ? 'bg-slate-700' : 'bg-slate-200'}`} />

            {/* Boya Kovası */}
            <button
              onClick={() => { setIsFill(true); setIsEraser(false); }}
              className={btnBase(isFill, isFullscreen)}
              title="Boya Kovası (Flood Fill)"
            >
              <PaintBucket size={16} />
            </button>

            {/* Silgi */}
            <button
              onClick={() => { setIsEraser(true); setIsFill(false); }}
              className={btnBase(isEraser, isFullscreen)}
              title="Silgi"
            >
              <Eraser size={16} />
            </button>

            {/* Kalem seç */}
            <button
              onClick={() => { setIsEraser(false); setIsFill(false); }}
              className={btnBase(activeTool === 'pen', isFullscreen)}
              title="Kalem"
            >
              ✏️
            </button>
          </div>

          {/* Fırça Boyutu Slider */}
          <div className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl shadow-sm ${isFullscreen ? 'bg-slate-800/80' : 'bg-white'}`}>
            {/* Önizleme noktası */}
            <div
              className="flex-shrink-0 rounded-full transition-all duration-150"
              style={{
                width:  Math.max(6, brushSize),
                height: Math.max(6, brushSize),
                backgroundColor: isEraser ? '#94a3b8' : color,
                opacity: 0.85,
                minWidth: 6,
                minHeight: 6,
              }}
            />
            <input
              type="range"
              min="1"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="flex-1 h-1.5 accent-pink-500 cursor-pointer"
              title="Fırça Kalınlığı"
            />
            <span className={`text-xs font-bold w-8 text-right flex-shrink-0 ${isFullscreen ? 'text-slate-300' : 'text-slate-500'}`}>
              {brushSize}px
            </span>
          </div>

          {/* Sohbete Gönder */}
          <button
            onClick={handleSendToChat}
            className="flex items-center justify-center gap-2 bg-pink-500 hover:bg-pink-600 text-white px-5 py-2.5 rounded-full shadow-sm transition-all font-medium w-full sm:w-auto self-end"
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
