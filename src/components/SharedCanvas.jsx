import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, push, set, serverTimestamp, update } from 'firebase/database';
import {
  Pencil, Eraser, PaintBucket, Undo2, Redo2,
  Maximize2, Minimize2, Send, Trash2,
  ChevronUp, ChevronDown, Palette,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const CANVAS_W = 1600;
const CANVAS_H = 1200;

// ═══════════════════════════════════════════════════════════════════════════════
//  PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function hexToRgb(hex) {
  if (!hex) return [0, 0, 0];
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function runFloodFill(ctx, canvas, sx, sy, fillHex, tol = 32) {
  if (!ctx || !canvas) return false;
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

  const stack = [sy * W + sx];
  const vis = new Uint8Array(W * H);

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

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const SharedCanvas = memo(function SharedCanvas({ currentUser, onFullscreenChange }) {
  // --- REFS ---
  const canvasRef      = useRef(null);
  const offscreenRef   = useRef(null);
  const contextRef     = useRef(null);
  const pointsRef      = useRef([]);        // live stroke points
  const isDrawingRef   = useRef(false);
  const strokeIdRef    = useRef(null);
  const redrawRafRef   = useRef(null);

  // --- PALETTE ---
  const mainColors = ['#ff808b', '#3bc1fb', '#34d399', '#fbbd23', '#a78bfa', '#475569'];

  // --- STATE ---
  const [slots, setSlots]           = useState(['#34d399', '#a78bfa', '#e2e8f0', '#e2e8f0']);
  const [activeSlot, setActiveSlot] = useState(1);
  const [tool, setTool]             = useState('pencil');
  const [brushSize, setBrushSize]   = useState(10);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isToolbarOpen, setIsToolbarOpen] = useState(true);
  const [redoStack, setRedoStack]   = useState([]);
  const [allSegments, setAllSegments] = useState([]);

  const segmentsRef = useRef([]);
  useEffect(() => { segmentsRef.current = allSegments; }, [allSegments]);

  const currentColor = slots[activeSlot] || '#000000';

  // ─────────────────────────────────────────────────────────────────────────
  //  OFFSCREEN CANVAS — created once, reused
  // ─────────────────────────────────────────────────────────────────────────

  const ensureOffscreen = useCallback(() => {
    if (!offscreenRef.current) {
      const off = document.createElement('canvas');
      off.width  = CANVAS_W;
      off.height = CANVAS_H;
      offscreenRef.current = off;
    }
    const off = offscreenRef.current;
    if (off.width !== CANVAS_W || off.height !== CANVAS_H) {
      off.width  = CANVAS_W;
      off.height = CANVAS_H;
    }
    return off;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  //  REDRAW: layered rendering so each user's eraser is isolated
  // ─────────────────────────────────────────────────────────────────────────

  const drawOneStroke = useCallback((ctx, canvas, stroke) => {
    if (stroke.type === 'fill') {
      runFloodFill(ctx, canvas, stroke.x, stroke.y, stroke.color);
      return;
    }
    if (stroke.type !== 'draw' || !stroke.points || stroke.points.length < 2) return;

    const pts = stroke.points;
    ctx.lineWidth  = stroke.tool === 'eraser' ? stroke.size * 5 : stroke.size;
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }, []);

  const redrawAll = useCallback((segments) => {
    if (redrawRafRef.current) cancelAnimationFrame(redrawRafRef.current);

    redrawRafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      // White background
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Cached offscreen scratch canvas (isolates each user's eraser)
      const off = ensureOffscreen();
      const oc = off.getContext('2d', { willReadFrequently: true });

      // Group segments → strokes per user
      const byUser = {};
      segments.forEach(seg => {
        const uid = seg.senderId || 'Anonim';
        if (!byUser[uid]) byUser[uid] = [];

        if (seg.type === 'fill') {
          byUser[uid].push({ ...seg });
        } else if (seg.type === 'draw') {
          let g = byUser[uid].find(x => x.strokeId === seg.strokeId && x.type === 'draw');
          if (!g) {
            g = { type: 'draw', strokeId: seg.strokeId, tool: seg.tool, color: seg.color, size: seg.size, points: [] };
            byUser[uid].push(g);
          }
          if (seg.p1 && seg.p2) {
            g.points.push(seg.p1, seg.p2);
          } else if (seg.points && Array.isArray(seg.points)) {
            g.points.push(...seg.points);
          }
        }
      });

      // Render other users first, current user on top (Layered Rendering — Eraser isolation)
      const others  = Object.keys(byUser).filter(id => id !== currentUser);
      const ordered = [...others, ...(byUser[currentUser] ? [currentUser] : [])];

      ordered.forEach(uid => {
        oc.clearRect(0, 0, off.width, off.height);
        oc.globalCompositeOperation = 'source-over';
        byUser[uid].forEach(stroke => drawOneStroke(oc, off, stroke));
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(off, 0, 0);
      });
    });
  }, [currentUser, drawOneStroke, ensureOffscreen]);

  // ─────────────────────────────────────────────────────────────────────────
  //  FIREBASE SYNC (read)
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // FIXED internal resolution — never changes
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    contextRef.current = canvas.getContext('2d', { willReadFrequently: true });

    const segRef = ref(rtdb, 'canvas/segments');
    const unsub  = onValue(segRef, snap => {
      const data = snap.val();
      const arr  = [];
      if (data) {
        Object.keys(data).sort().forEach(k => {
          if (data[k].type === 'clear') arr.length = 0;
          else arr.push({ ...data[k], key: k });
        });
      }
      setAllSegments(arr);
      // Only redraw if user is NOT actively drawing → prevents double-draw "reflection"
      if (!isDrawingRef.current) redrawAll(arr);
    });

    return () => {
      unsub();
      if (redrawRafRef.current) cancelAnimationFrame(redrawRafRef.current);
    };
  }, [redrawAll]);

  // ─────────────────────────────────────────────────────────────────────────
  //  GLOBAL INPUT EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  const stopDrawing = useCallback(async () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const pts = pointsRef.current;
    if (pts.length >= 2 && tool !== 'fill') {
      // Push the ENTIRE stroke at once → redrawAll fires only once → no double-draw
      await push(ref(rtdb, 'canvas/segments'), {
        type:     'draw',
        tool,
        color:    currentColor,
        size:     brushSize,
        points:   pts,           // full array of points stored in one document
        strokeId: strokeIdRef.current,
        senderId: currentUser || 'Anonim',
        timestamp: serverTimestamp(),
      });
    }
    pointsRef.current = [];
  }, [tool, currentColor, brushSize, currentUser]);

  useEffect(() => {
    window.addEventListener('mouseup',  stopDrawing);
    window.addEventListener('touchend', stopDrawing, { passive: false });
    return () => {
      window.removeEventListener('mouseup',  stopDrawing);
      window.removeEventListener('touchend', stopDrawing);
    };
  }, [stopDrawing]);

  // ─────────────────────────────────────────────────────────────────────────
  //  FULLSCREEN (CSS-only, works on iOS)
  // ─────────────────────────────────────────────────────────────────────────

  const toggleFullscreen = () => {
    setIsFullscreen(f => {
      const next = !f;
      if (onFullscreenChange) onFullscreenChange(next);
      return next;
    });
  };

  // No ResizeObserver needed — canvas resolution is fixed at CANVAS_W×CANVAS_H.
  // CSS handles visual scaling via w-full/h-full + object-contain on the canvas.

  // ─────────────────────────────────────────────────────────────────────────
  //  UNDO / REDO
  // ─────────────────────────────────────────────────────────────────────────

  // Sadece mevcut kullanıcının en son stroke'unu geri alır
  const handleUndo = async () => {
    // currentUser'a ait segmentleri filtrele
    const mySegments = allSegments.filter(s => (s.senderId || 'Anonim') === (currentUser || 'Anonim'));
    if (mySegments.length === 0) return;

    // Benim en son strokeId'mi bul
    const myLast  = mySegments[mySegments.length - 1];
    const lastSId = myLast.strokeId;

    // O strokeId'ye ait TÜM segmentler (sadece benim olanlar)
    const targets = allSegments.filter(
      s => s.strokeId === lastSId && (s.senderId || 'Anonim') === (currentUser || 'Anonim')
    );
    if (!targets.length) return;

    const deepCopy = JSON.parse(JSON.stringify(targets));
    setRedoStack(prev => [...prev, { strokeId: lastSId, segments: deepCopy, type: 'stroke' }]);

    const updates = {};
    targets.forEach(s => { updates[s.key] = null; });
    await update(ref(rtdb, 'canvas/segments'), updates);
  };

  const handleRedo = async () => {
    if (!redoStack.length) return;
    const top = redoStack[redoStack.length - 1];

    if (top.type === 'clear') {
      // Clear redo: tüm segmentleri geri yükle (clear sentinel'siz)
      await set(ref(rtdb, 'canvas/segments'), null);
      for (const seg of top.segments) {
        const { key, ...clean } = seg;
        await push(ref(rtdb, 'canvas/segments'), clean);
      }
    } else {
      // Normal stroke redo
      for (const seg of top.segments) {
        const { key, ...clean } = seg;
        await push(ref(rtdb, 'canvas/segments'), clean);
      }
    }
    setRedoStack(prev => prev.slice(0, -1));
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  CLEAR / SEND TO CHAT
  // ─────────────────────────────────────────────────────────────────────────

  const clearCanvas = useCallback(async () => {
    // Silinecek gerçek segmentler (clear sentinel'ini hariç tut)
    const realSegs = allSegments.filter(s => s.type !== 'clear');
    if (!realSegs.length) return;
    // Tüm canvas'ı redo stack'e yedekle
    const deepCopy = JSON.parse(JSON.stringify(realSegs));
    setRedoStack(prev => [...prev, { strokeId: '__clear__', type: 'clear', segments: deepCopy }]);
    // Firebase'i tamamen temizle (clear sentinel YAZMA — redo bozulmasın)
    await set(ref(rtdb, 'canvas/segments'), null);
  }, [allSegments]);

  const handleSendToChat = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    push(ref(rtdb, 'chat/messages'), {
      type:     'image',
      imageUrl: canvas.toDataURL('image/png'),
      senderId: currentUser || 'Anonim',
      timestamp: serverTimestamp(),
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  LIVE DRAWING (local canvas only — no Firebase writes mid-stroke)
  // ─────────────────────────────────────────────────────────────────────────

  const getCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const src    = e.touches?.[0] ?? e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  };

  const startDrawing = (e) => {
    const coords = getCoords(e);
    if (!coords) return;

    if (tool === 'fill') {
      const strokeId = Math.random().toString(36).substring(7);
      push(ref(rtdb, 'canvas/segments'), {
        type: 'fill', x: coords.x, y: coords.y,
        color: currentColor, strokeId,
        senderId: currentUser || 'Anonim',
        timestamp: serverTimestamp(),
      });
      // Yeni çizim: sadece BU kullanıcının redo geçmişini temizle
      setRedoStack(prev => prev.filter(r => r.type === 'clear'));
      return;
    }

    isDrawingRef.current = true;
    strokeIdRef.current  = Math.random().toString(36).substring(7);
    pointsRef.current    = [coords];
    // Yeni çizim: sadece BU kullanıcının stroke redo'sunu temizle (clear redo'yu koru)
    setRedoStack(prev => prev.filter(r => r.type === 'clear'));

    const ctx = contextRef.current;
    if (!ctx) return;
    ctx.lineWidth  = tool === 'eraser' ? brushSize * 5 : brushSize;
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.strokeStyle = currentColor;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const draw = (e) => {
    if (!isDrawingRef.current) return;
    const coords = getCoords(e);
    if (!coords) return;

    // Draw live — pure moveTo/lineTo, no math, no effects
    const ctx = contextRef.current;
    if (ctx) {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }
    pointsRef.current.push(coords);
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  PALETTE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const handlePaletteClick = (color) => {
    const s = [...slots]; s[activeSlot] = color;
    setSlots(s); setTool('pencil');
  };
  const handleWheelChange = (color) => {
    const s = [...slots]; s[activeSlot] = color;
    setSlots(s); setTool('pencil');
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  DERIVED
  // ─────────────────────────────────────────────────────────────────────────

  const hasMySegments = allSegments.some(s => (s.senderId || 'Anonim') === (currentUser || 'Anonim'));
  const hasRedo       = redoStack.length > 0;

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className={`flex flex-col items-center w-full transition-all duration-300 ${
        isFullscreen
          ? 'fixed inset-0 z-[9999] bg-gradient-to-b from-rose-50/60 via-white to-sky-50/40 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] px-4 sm:px-6 overflow-hidden'
          : 'relative'
      }`}
    >
      {isFullscreen && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-4 z-[10005] w-10 h-10 flex items-center justify-center bg-white hover:bg-slate-50 text-sky-500 rounded-full shadow-lg border border-slate-100 transition-transform active:scale-90"
          title="Tam Ekrandan Çık"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      )}
      {/* ── Header ── */}
      <div
        className={`w-full max-w-4xl flex justify-between items-center rounded-3xl transition-all z-[10000] flex-shrink-0 ${
          isFullscreen
            ? 'h-14 px-4 shadow-sm border border-pink-100/60 bg-white/70 backdrop-blur-md'
            : 'mb-4 px-4 h-14 relative bg-white/50 backdrop-blur-sm'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-400 to-rose-300 flex items-center justify-center shadow-sm">
            <Palette className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-bold bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent tracking-tight">
            Çizim Alanı
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Undo / Redo */}
          <div className="flex gap-0.5 bg-slate-50/80 p-0.5 rounded-xl">
            <button
              onClick={handleUndo}
              disabled={!hasMySegments}
              className="w-9 h-9 flex items-center justify-center bg-white hover:bg-pink-50 rounded-lg disabled:opacity-25 transition-all shadow-sm border border-slate-100/60"
              title="Geri Al"
            >
              <Undo2 className="w-4 h-4 text-slate-500" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!hasRedo}
              className="w-9 h-9 flex items-center justify-center bg-white hover:bg-pink-50 rounded-lg disabled:opacity-25 transition-all shadow-sm border border-slate-100/60"
              title="İleri Al"
            >
              <Redo2 className="w-4 h-4 text-slate-500" />
            </button>
          </div>

          {/* Fullscreen */}
          {!isFullscreen && (
            <button
              onClick={toggleFullscreen}
              className="w-9 h-9 flex items-center justify-center bg-sky-50/80 hover:bg-sky-100 text-sky-500 rounded-xl transition-all shadow-sm border border-sky-100/60"
              title="Tam Ekran"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}

          {/* Send to chat */}
          <button
            onClick={handleSendToChat}
            className="w-9 h-9 flex items-center justify-center bg-sky-50/80 hover:bg-sky-100 text-sky-400 rounded-xl transition-all shadow-sm border border-sky-100/60"
            title="Sohbete Gönder"
          >
            <Send className="w-4 h-4" />
          </button>

          {/* Clear */}
          <button
            onClick={clearCanvas}
            className="w-9 h-9 flex items-center justify-center bg-rose-50/80 hover:bg-rose-100 text-rose-400 rounded-xl transition-all border border-rose-100/60"
            title="Temizle"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        className={`w-full max-w-4xl rounded-[2rem] sm:rounded-[2.5rem] p-3 sm:p-5 border-2 border-dashed border-pink-100/60 transition-all duration-300 flex flex-col bg-white ${
          isFullscreen
            ? 'flex-1 min-h-0 my-3'
            : 'relative aspect-[4/3] sm:aspect-video'
        }`}
        style={{ boxShadow: '0 20px 60px -15px rgba(244,114,182,0.08)' }}
      >
        <div className="flex-1 w-full relative min-h-0">
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="absolute inset-0 w-full h-full rounded-[1rem] sm:rounded-[1.5rem]"
            style={{
              touchAction: 'none',
              cursor: tool === 'fill' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'crosshair',
            }}
          />
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div
        className={`w-full max-w-md flex flex-col items-center bg-white/90 backdrop-blur-sm rounded-[2rem] sm:rounded-[3rem] border border-pink-100/50 transition-all duration-300 z-[10000] flex-shrink-0 ${
          isFullscreen ? 'mb-2' : 'mt-4 sm:mt-8 relative'
        }`}
        style={{ boxShadow: '0 10px 40px -10px rgba(244,114,182,0.12)' }}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setIsToolbarOpen(!isToolbarOpen)}
          className="w-full h-8 flex items-center justify-center hover:bg-pink-50/40 rounded-t-[2rem] sm:rounded-t-[3rem] transition-colors group cursor-pointer"
          title={isToolbarOpen ? 'Araçları Gizle' : 'Araçları Göster'}
        >
          {isToolbarOpen
            ? <ChevronDown className="w-4 h-4 text-slate-300 group-hover:text-pink-400 transition-colors" />
            : <ChevronUp className="w-4 h-4 text-slate-300 group-hover:text-pink-400 transition-colors" />
          }
        </button>

        <div
          className={`w-full flex justify-center transition-all duration-300 overflow-hidden ${
            isToolbarOpen ? 'max-h-[30rem] opacity-100 pb-4 sm:pb-6' : 'max-h-0 opacity-0 pb-0'
          }`}
        >
          <div className="flex flex-col gap-3 sm:gap-5 px-4 sm:px-6 w-full items-center">
            {/* Row 1: Tool buttons */}
            <div className="flex items-center justify-center gap-1.5">
              <button
                onClick={() => setTool('pencil')}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                  tool === 'pencil'
                    ? 'bg-gradient-to-br from-pink-400 to-rose-400 text-white scale-110 shadow-md shadow-pink-200/50'
                    : 'bg-slate-50 text-slate-400 hover:bg-pink-50 hover:text-pink-400'
                }`}
                title="Kalem"
              >
                <Pencil className="w-4.5 h-4.5" />
              </button>
              <button
                onClick={() => setTool('fill')}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                  tool === 'fill'
                    ? 'bg-gradient-to-br from-pink-400 to-rose-400 text-white scale-110 shadow-md shadow-pink-200/50'
                    : 'bg-slate-50 text-slate-400 hover:bg-pink-50 hover:text-pink-400'
                }`}
                title="Boya Kovası"
              >
                <PaintBucket className="w-4.5 h-4.5" />
              </button>
              <button
                onClick={() => setTool('eraser')}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                  tool === 'eraser'
                    ? 'bg-gradient-to-br from-pink-400 to-rose-400 text-white scale-110 shadow-md shadow-pink-200/50'
                    : 'bg-slate-50 text-slate-400 hover:bg-pink-50 hover:text-pink-400'
                }`}
                title="Silgi"
              >
                <Eraser className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Row 2: Main colors + wheel */}
            <div className="flex items-center justify-center gap-2.5">
              {mainColors.map(c => (
                <button
                  key={c}
                  onClick={() => handlePaletteClick(c)}
                  className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full transition-all ${
                    currentColor === c
                      ? 'ring-2 ring-offset-2 ring-pink-400 scale-110 shadow-lg'
                      : 'ring-2 ring-white hover:scale-105 shadow-sm'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <div className="w-px h-6 bg-slate-100 mx-0.5" />
              <div
                className="relative w-9 h-9 rounded-full overflow-hidden shadow-sm hover:scale-110 transition-all ring-2 ring-slate-100"
                style={{ background: 'conic-gradient(from 180deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
              >
                <input
                  type="color"
                  value={currentColor}
                  onChange={e => handleWheelChange(e.target.value)}
                  className="absolute inset-[-50%] w-[200%] h-[200%] cursor-pointer opacity-0"
                />
              </div>
            </div>

            {/* Row 3: Slots */}
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50/50 rounded-2xl">
                {slots.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSlot(i)}
                    className={`w-7 h-7 rounded-full transition-all ${
                      activeSlot === i
                        ? 'ring-2 ring-offset-2 ring-pink-400 scale-125 shadow-md z-10'
                        : 'ring-2 ring-white opacity-40 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Row 4: Brush size slider */}
            <div className="flex items-center gap-3 bg-slate-50/30 p-3 rounded-2xl w-full">
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <div
                  style={{
                    width: Math.max(3, brushSize / 2),
                    height: Math.max(3, brushSize / 2),
                    backgroundColor: currentColor,
                    borderRadius: '50%',
                  }}
                  className="transition-all"
                />
              </div>
              <input
                type="range"
                min="1"
                max="50"
                value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #f472b6 0%, #f472b6 ${((brushSize - 1) / 49) * 100}%, #e2e8f0 ${((brushSize - 1) / 49) * 100}%, #e2e8f0 100%)`,
                }}
              />
              <span className="text-[10px] font-bold text-slate-400 w-8 flex-shrink-0 text-right">
                {brushSize}px
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Slider thumb styling — minimal inline style to replace dangerouslySetInnerHTML */}
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 18px;
          width: 18px;
          border-radius: 50%;
          background: #f472b6;
          box-shadow: 0 2px 10px rgba(244,114,182,.4);
          cursor: pointer;
          border: 3px solid white;
          transition: all .2s;
        }
        input[type=range]::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }
        input[type=range]::-moz-range-thumb {
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #f472b6;
          box-shadow: 0 2px 10px rgba(244,114,182,.4);
          cursor: pointer;
          border: 3px solid white;
        }
      `}</style>
    </div>
  );
});

export default SharedCanvas;
