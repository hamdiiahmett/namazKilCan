import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, push, set, serverTimestamp } from 'firebase/database';
import { Trash2, Eraser, Undo2, Send, Maximize, X, PaintBucket } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
//  PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function perpDist(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy);
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > tol) {
    return [
      ...douglasPeucker(pts.slice(0, maxI + 1), tol).slice(0, -1),
      ...douglasPeucker(pts.slice(maxI), tol),
    ];
  }
  return [pts[0], pts[pts.length - 1]];
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function runFloodFill(ctx, canvas, sx, sy, fillHex, tol = 32) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  const W = canvas.width, H = canvas.height;
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return false;
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  const si = (sy * W + sx) * 4;
  const [sr, sg, sb, sa] = [d[si], d[si + 1], d[si + 2], d[si + 3]];
  const [fr, fg, fb] = hexToRgb(fillHex);
  if (sr === fr && sg === fg && sb === fb && sa === 255) return false;
  const match = i =>
    Math.abs(d[i] - sr) <= tol && Math.abs(d[i + 1] - sg) <= tol &&
    Math.abs(d[i + 2] - sb) <= tol && Math.abs(d[i + 3] - sa) <= tol;
  const vis = new Uint8Array(W * H);
  const stack = [sy * W + sx];
  while (stack.length > 0) {
    const lin = stack.pop();
    if (vis[lin]) continue;
    vis[lin] = 1;
    const pi = lin * 4;
    if (!match(pi)) continue;
    d[pi] = fr; d[pi + 1] = fg; d[pi + 2] = fb; d[pi + 3] = 255;
    const x = lin % W, y = (lin / W) | 0;
    if (x + 1 < W)  stack.push(lin + 1);
    if (x - 1 >= 0) stack.push(lin - 1);
    if (y + 1 < H)  stack.push(lin + W);
    if (y - 1 >= 0) stack.push(lin - W);
  }
  ctx.putImageData(imgData, 0, 0);
  return true;
}
function applyCtxStyle(ctx, color, width, isEraser) {
  ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
  ctx.lineWidth   = isEraser ? width * 4 : width;
  ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
}
function drawSmoothStroke(ctx, pts, color, width, isEraser) {
  if (pts.length < 1) return;
  ctx.save();
  applyCtxStyle(ctx, color, width, isEraser);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(1, (isEraser ? width * 2 : width) / 2), 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : color;
    ctx.fill();
  } else if (pts.length === 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}
function drawIncrementalSmooth(ctx, seg, strokeBuffers) {
  let state = strokeBuffers.get(seg.strokeId);
  if (!state) {
    state = { points: [{ x: seg.x0, y: seg.y0 }], lastMid: null, color: seg.color, width: seg.width ?? 4, isEraser: seg.isEraser };
    strokeBuffers.set(seg.strokeId, state);
  }
  state.points.push({ x: seg.x1, y: seg.y1 });
  const pts = state.points;
  const n = pts.length;
  ctx.save();
  applyCtxStyle(ctx, state.color, state.width, state.isEraser);
  ctx.beginPath();
  if (n === 2) {
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(mid.x, mid.y);
    ctx.stroke();
    state.lastMid = mid;
  } else if (n >= 3) {
    const ctrl = pts[n - 2];
    const newMid = { x: (ctrl.x + pts[n - 1].x) / 2, y: (ctrl.y + pts[n - 1].y) / 2 };
    const start = state.lastMid ?? pts[0];
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, newMid.x, newMid.y);
    ctx.stroke();
    state.lastMid = newMid;
  }
  ctx.restore();
}

const SharedCanvas = memo(function SharedCanvas({ currentUser }) {
  const canvasRef = useRef(null);
  const snapCanvasRef = useRef(null);
  const strokeBuffersRef = useRef(new Map());

  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#fb7185');
  const [isEraser, setIsEraser] = useState(false);
  const [isFill, setIsFill] = useState(false);
  const [brushSize, setBrushSize] = useState(4);
  const [history, setHistory] = useState([]); // [{id, snapshot}]
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recentColors, setRecentColors] = useState(['#fb7185', '#38bdf8', '#34d399', '#fbbf24']);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);

  const colorRef = useRef(color);
  const isEraserRef = useRef(isEraser);
  const isFillRef = useRef(isFill);
  const brushSizeRef = useRef(brushSize);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const currentStrokeIdRef = useRef('');
  const currentStrokePtsRef = useRef([]);
  const allSegmentsRef = useRef([]);
  const undoneStrokesRef = useRef(new Set());
  const pendingLocalRef = useRef(new Set());
  const lastFillStrokeRef = useRef(null);

  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { isEraserRef.current = isEraser; }, [isEraser]);
  useEffect(() => { isFillRef.current = isFill; }, [isFill]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  const lastPushTimeRef = useRef(0);
  const pendingSegRef = useRef(null);
  const pushTimerRef = useRef(null);
  const rafRef = useRef(null);

  const colors = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#475569'];

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (cx - rect.left) * (canvas.width / rect.width),
      y: (cy - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const redrawAll = useCallback((ctx, canvas) => {
    // Note: Local user now uses snapshots for undo, but this handles remote undos/syncs
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const order = [];
    const map = new Map();
    for (const s of allSegmentsRef.current) {
      if (undoneStrokesRef.current.has(s.strokeId)) continue;
      if (!map.has(s.strokeId)) {
        map.set(s.strokeId, { points: [{ x: s.x0, y: s.y0 }], color: s.color, width: s.width ?? 4, isEraser: s.isEraser });
        order.push(s.strokeId);
      }
      map.get(s.strokeId).points.push({ x: s.x1, y: s.y1 });
    }
    for (const id of order) {
      const { points, color, width, isEraser } = map.get(id);
      drawSmoothStroke(ctx, points, color, width, isEraser);
    }
    snapCanvasRef.current?.getContext('2d').drawImage(canvas, 0, 0);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = 500; canvas.height = 300;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const snap = document.createElement('canvas');
    snap.width = 500; snap.height = 300;
    const snapCtx = snap.getContext('2d');
    snapCtx.fillStyle = '#ffffff'; snapCtx.fillRect(0, 0, 500, 300);
    snapCanvasRef.current = snap;

    const unsubscribe = onChildAdded(ref(rtdb, 'canvas/segments'), (snapshot) => {
      const seg = snapshot.val();
      if (!seg) return;

      if (seg.fillCanvas) {
        if (seg.strokeId === lastFillStrokeRef.current) {
          lastFillStrokeRef.current = null;
          allSegmentsRef.current = []; undoneStrokesRef.current = new Set();
          return;
        }
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          snapCtx.clearRect(0, 0, 500, 300); snapCtx.drawImage(canvas, 0, 0);
        };
        img.src = seg.imageData;
        allSegmentsRef.current = []; undoneStrokesRef.current = new Set();
        return;
      }
      if (seg.clear) {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        snapCtx.fillStyle = '#ffffff'; snapCtx.fillRect(0, 0, 500, 300);
        allSegmentsRef.current = []; undoneStrokesRef.current = new Set();
        return;
      }
      if (seg.undo) {
        undoneStrokesRef.current.add(seg.strokeId);
        redrawAll(ctx, canvas);
        return;
      }
      allSegmentsRef.current.push(seg);
      if (undoneStrokesRef.current.has(seg.strokeId) || pendingLocalRef.current.has(seg.strokeId)) return;
      drawIncrementalSmooth(ctx, seg, strokeBuffersRef.current);
    });

    return () => { unsubscribe(); };
  }, [redrawAll]);

  const startDraw = useCallback((e) => {
    if (!canvasRef.current || !snapCanvasRef.current) return;
    const pos = getPos(e);
    const snapCtx = snapCanvasRef.current.getContext('2d');
    snapCtx.clearRect(0, 0, 500, 300);
    snapCtx.drawImage(canvasRef.current, 0, 0);

    const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    currentStrokeIdRef.current = strokeId;
    lastPosRef.current = pos;
    currentStrokePtsRef.current = [pos];
    pendingLocalRef.current.add(strokeId);

    // Save snapshot for local undo
    const snapshot = canvasRef.current.toDataURL('image/png');
    setHistory(prev => [...prev, { id: strokeId, snapshot }]);
    setIsDrawing(true);
  }, [getPos]);

  const handleCanvasMouseDown = useCallback((e) => {
    if (isFillRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const pos = getPos(e);
      const snapshot = canvas.toDataURL('image/png'); // Before fill

      if (runFloodFill(ctx, canvas, pos.x, pos.y, colorRef.current)) {
        const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        lastFillStrokeRef.current = strokeId;
        push(ref(rtdb, 'canvas/segments'), {
          fillCanvas: true,
          imageData: canvas.toDataURL('image/png'),
          strokeId,
        });
        setHistory(prev => [...prev, { id: strokeId, snapshot }]);
        allSegmentsRef.current = []; undoneStrokesRef.current = new Set();
        snapCanvasRef.current?.getContext('2d').drawImage(canvas, 0, 0);
      }
    } else {
      startDraw(e);
    }
  }, [getPos, startDraw]);

  useEffect(() => {
    if (!isDrawing) return;
    const handleMove = (e) => {
      if (e.cancelable && e.type === 'touchmove') e.preventDefault();
      const pos = getPos(e);
      currentStrokePtsRef.current.push(pos);

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || !snapCanvasRef.current) return;
        ctx.clearRect(0, 0, 500, 300);
        ctx.drawImage(snapCanvasRef.current, 0, 0);
        drawSmoothStroke(ctx, currentStrokePtsRef.current, colorRef.current, brushSizeRef.current, isEraserRef.current);
      });

      const now = performance.now();
      if (now - lastPushTimeRef.current >= 16) {
        lastPushTimeRef.current = now;
        const lp = lastPosRef.current;
        push(ref(rtdb, 'canvas/segments'), {
          strokeId: currentStrokeIdRef.current,
          x0: lp.x, y0: lp.y, x1: pos.x, y1: pos.y,
          color: colorRef.current, width: brushSizeRef.current, isEraser: isEraserRef.current
        });
      }
      lastPosRef.current = pos;
    };
    const handleEnd = () => {
      setIsDrawing(false);
      const canvas = canvasRef.current;
      if (canvas && snapCanvasRef.current) {
        snapCanvasRef.current.getContext('2d').drawImage(canvas, 0, 0);
      }
      const pts = currentStrokePtsRef.current;
      if (pts.length >= 2) {
        const sim = douglasPeucker(pts, 1.5);
        for (let i = 0; i < sim.length - 1; i++) {
          push(ref(rtdb, 'canvas/segments'), {
            strokeId: currentStrokeIdRef.current,
            x0: sim[i].x, y0: sim[i].y, x1: sim[i+1].x, y1: sim[i+1].y,
            color: colorRef.current, width: brushSizeRef.current, isEraser: isEraserRef.current
          });
        }
      }
      const sid = currentStrokeIdRef.current;
      setTimeout(() => pendingLocalRef.current.delete(sid), 2000);
    };
    window.addEventListener('mousemove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDrawing, getPos]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    const img = new Image();
    img.onload = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 500, 300);
      ctx.drawImage(img, 0, 0);
      snapCanvasRef.current?.getContext('2d').drawImage(canvasRef.current, 0, 0);
    };
    img.src = last.snapshot;
    setHistory(prev => prev.slice(0, -1));
    push(ref(rtdb, 'canvas/segments'), { undo: true, strokeId: last.id });
  }, [history]);

  const clearCanvas = useCallback(() => {
    set(ref(rtdb, 'canvas/segments'), null);
    push(ref(rtdb, 'canvas/segments'), { clear: true });
    setHistory([]);
  }, []);

  const handleSendToChat = useCallback(() => {
    if (!canvasRef.current) return;
    push(ref(rtdb, 'chat/messages'), {
      type: 'image',
      imageUrl: canvasRef.current.toDataURL('image/png'),
      senderId: currentUser || 'Anonim',
      timestamp: serverTimestamp(),
    });
  }, [currentUser]);

  const handleColorPick = useCallback((newColor) => {
    setColor(newColor);
    setIsEraser(false);
    setIsFill(false);
    
    setRecentColors(prev => {
      const next = [...prev];
      next[activeSlotIndex] = newColor;
      return next;
    });
  }, [activeSlotIndex]);

  const handleSlotClick = useCallback((index) => {
    setActiveSlotIndex(index);
    const slotColor = recentColors[index];
    if (slotColor && slotColor !== '#ffffff' && slotColor !== 'transparent') {
      setColor(slotColor);
      setIsEraser(false);
      setIsFill(false);
    }
  }, [recentColors]);

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-900/98 backdrop-blur-xl p-4 sm:p-8 flex flex-col' : 'bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 p-5 sm:p-7'} flex flex-col items-center transition-all duration-500`}>
      <div className={`w-full ${isFullscreen ? 'max-w-5xl my-auto' : ''}`}>
        <div className="w-full flex justify-between items-center mb-6">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🎨</span>
            <h2 className={`font-bold text-sm tracking-tight ${isFullscreen ? 'text-white' : 'text-slate-600'}`}>Çizim Alanı</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setIsFullscreen(f => !f)} className={`w-9 h-9 flex items-center justify-center rounded-2xl transition-all shadow-sm ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
              {isFullscreen ? <X size={16} /> : <Maximize size={16} />}
            </button>
            <button onClick={handleUndo} disabled={history.length === 0} className={`w-9 h-9 flex items-center justify-center rounded-2xl transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
              <Undo2 size={16} />
            </button>
            <button onClick={clearCanvas} className={`w-9 h-9 flex items-center justify-center rounded-2xl transition-all shadow-sm ${isFullscreen ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'bg-rose-50 text-rose-400 hover:bg-rose-100'}`}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <div className={`w-full border-2 ${isFullscreen ? 'border-slate-700 bg-slate-800 shadow-2xl' : 'border-dashed border-slate-200 bg-slate-50 shadow-inner'} rounded-2xl overflow-hidden mb-4 touch-none relative`}>
          <canvas ref={canvasRef} onMouseDown={handleCanvasMouseDown} onTouchStart={handleCanvasMouseDown} className={`w-full aspect-[5/3] bg-white block ${isFill ? 'cursor-cell' : 'cursor-crosshair'}`} />
        </div>
        <div className="w-full flex flex-col gap-3">
          <div className={`flex justify-center flex-wrap gap-2 px-4 py-2 rounded-full shadow-sm items-center w-full ${isFullscreen ? 'bg-slate-800/80 border border-slate-700' : 'bg-white border border-slate-50'}`}>
            {colors.map(c => (
              <button key={c} onClick={() => handleColorPick(c)} className={`w-8 h-8 rounded-full transition-all duration-200 shadow-sm flex-shrink-0 ${color === c && !isEraser && !isFill ? 'scale-125 ring-2 ring-offset-1 shadow-md' : 'hover:scale-110'}`} style={{ backgroundColor: c, ...(color === c && !isEraser && !isFill ? { boxShadow: `0 0 0 2px white, 0 0 0 4px ${c}` } : {}) }} />
            ))}
            <div className={`relative w-8 h-8 rounded-full transition-all shadow-sm overflow-hidden cursor-pointer ${!colors.includes(color) && !isEraser && !isFill ? 'scale-125 ring-2 ring-offset-1 ring-slate-400' : 'hover:scale-110'}`} style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
              <input type="color" value={colors.includes(color) ? '#000000' : color} onChange={(e) => handleColorPick(e.target.value)} className="absolute inset-0 w-[150%] h-[150%] top-[-25%] left-[-25%] opacity-0 cursor-pointer" />
            </div>
            <div className="w-[1px] h-5 mx-1 bg-slate-200 hidden sm:block" />
            <div className="flex gap-1.5 items-center px-1.5 py-1 bg-slate-50/50 rounded-full border border-slate-100">
              {recentColors.map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  onClick={() => handleSlotClick(i)}
                  className={`w-6 h-6 rounded-full transition-all duration-200 shadow-sm border ${
                    activeSlotIndex === i 
                      ? 'scale-125 ring-2 ring-offset-1 ring-sky-400 border-white z-10' 
                      : 'border-slate-100/50 hover:scale-110 opacity-80'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="w-[1px] h-5 mx-1 bg-slate-200 hidden sm:block" />
            <button onClick={() => { setIsFill(true); setIsEraser(false); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isFill ? 'bg-slate-800 text-white shadow-lg scale-110' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}><PaintBucket size={16} /></button>
            <button onClick={() => { setIsEraser(true); setIsFill(false); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isEraser ? 'bg-slate-800 text-white shadow-lg scale-110' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}><Eraser size={16} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full">
            <div className={`flex flex-1 items-center gap-3 px-4 py-1.5 rounded-full border shadow-sm ${isFullscreen ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-50/50 border-slate-100'}`}>
              <input type="range" min="1" max="50" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="flex-1 h-1 accent-sky-400 cursor-pointer" />
              <span className="text-[10px] font-bold w-6 text-slate-400">{brushSize}p</span>
            </div>
            <button onClick={handleSendToChat} className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-full shadow-md transition-all font-bold text-xs flex items-center gap-2">
              <span>Sohbete Gönder</span><Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default SharedCanvas;
