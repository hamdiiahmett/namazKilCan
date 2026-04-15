import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, push, set, serverTimestamp } from 'firebase/database';
import { Trash2, Eraser, Undo2, Send, Maximize, X, PaintBucket } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
//  PURE HELPERS  (bileşen dışı — stabil referans, her render'da yeniden oluşmaz)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Douglas-Peucker ──────────────────────────────────────────────────────────
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

// ── Hex → [r,g,b] ────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Flood Fill ────────────────────────────────────────────────────────────────
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
    Math.abs(d[i]     - sr) <= tol && Math.abs(d[i + 1] - sg) <= tol &&
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

// ── Canvas context setup ──────────────────────────────────────────────────────
function applyCtxStyle(ctx, color, width, isEraser) {
  ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
  ctx.lineWidth   = isEraser ? width * 4 : width;
  ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color;
  ctx.lineCap     = 'round';  // ← Yuvarlak uçlar
  ctx.lineJoin    = 'round';  // ← Yuvarlak birleşimler
}

// ── Quadratic Curve ile SMOOTH stroke çiz (lokal önizleme + undo/redrawAll) ──
//   Midpoint-quadratic algoritması: köşeli lineTo yerine kavisli quadraticCurveTo
function drawSmoothStroke(ctx, pts, color, width, isEraser) {
  if (pts.length < 1) return;
  ctx.save();
  applyCtxStyle(ctx, color, width, isEraser);

  if (pts.length === 1) {
    // Tek nokta → küçük daire (nokta gibi çizim)
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
    // Midpoint-quadratic: P[i] kontrol noktası, mid(P[i], P[i+1]) bitiş noktası
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    // Son segmenti doğrudan son noktaya bağla
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Incremental smooth draw (diğer kullanıcıdan gelen segmentler için) ────────
//   Her yeni segment geldiğinde sadece yeni kavis parçasını çiz (tümünü silmeden)
//   strokeBuffers: Map<strokeId, { points, lastMid, color, width, isEraser }>
function drawIncrementalSmooth(ctx, seg, strokeBuffers) {
  let state = strokeBuffers.get(seg.strokeId);
  if (!state) {
    state = {
      points:   [{ x: seg.x0, y: seg.y0 }],
      lastMid:  null,
      color:    seg.color,
      width:    seg.width ?? 4,
      isEraser: seg.isEraser,
    };
    strokeBuffers.set(seg.strokeId, state);
  }
  state.points.push({ x: seg.x1, y: seg.y1 });
  const pts = state.points;
  const n   = pts.length;

  ctx.save();
  applyCtxStyle(ctx, state.color, state.width, state.isEraser);
  ctx.beginPath();

  if (n === 2) {
    // İlk segment: P0'dan mid(P0,P1)'e lineTo
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(mid.x, mid.y);
    ctx.stroke();
    state.lastMid = mid;
  } else if (n >= 3) {
    // Sonraki segmentler: lastMid'den yeni mid'e quadraticCurveTo
    const ctrl   = pts[n - 2];
    const newMid = { x: (ctrl.x + pts[n - 1].x) / 2, y: (ctrl.y + pts[n - 1].y) / 2 };
    const start  = state.lastMid ?? pts[0];
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, newMid.x, newMid.y);
    ctx.stroke();
    state.lastMid = newMid;
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ANA BİLEŞEN
// ═══════════════════════════════════════════════════════════════════════════════
const SharedCanvas = memo(function SharedCanvas({ currentUser }) {
  const canvasRef    = useRef(null);
  // Offscreen canvas: her stroke başlamadan önce mevcut canvas state'ini saklar.
  // handleMove sırasında bu snapshot'a dönüp üstüne smooth çizim çizeriz →
  // gerçek zamanlı, kesintisiz, kavisli lokal önizleme.
  const snapCanvasRef = useRef(null);
  // Diğer kullanıcıdan gelen segmentler için per-stroke nokta tamponları
  const strokeBuffersRef = useRef(new Map());

  const [isDrawing,    setIsDrawing]    = useState(false);
  const [color,        setColor]        = useState('#fb7185');
  const [isEraser,     setIsEraser]     = useState(false);
  const [isFill,       setIsFill]       = useState(false);
  const [brushSize,    setBrushSize]    = useState(4);
  const [history,      setHistory]      = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recentColors, setRecentColors] = useState(['#fb7185', '#38bdf8', '#34d399', '#fbbf24']);

  // Ref: Son geçerli Fill snapshot'ı (Redraw-safe arka plan)
  const baseImageRef = useRef(null);

  // Ref'ler: event handler'larda her zaman güncel değer
  const colorRef     = useRef(color);
  const isEraserRef  = useRef(isEraser);
  const isFillRef    = useRef(isFill);
  const brushSizeRef = useRef(brushSize);
  const lastPosRef   = useRef({ x: 0, y: 0 });

  useEffect(() => { colorRef.current     = color;     }, [color]);
  useEffect(() => { isEraserRef.current  = isEraser;  }, [isEraser]);
  useEffect(() => { isFillRef.current    = isFill;    }, [isFill]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  const currentStrokeIdRef   = useRef('');
  const currentStrokePtsRef  = useRef([]);  // Canlı nokta tamponu (lokal çizim)
  const allSegmentsRef       = useRef([]);
  const undoneStrokesRef     = useRef(new Set());
  // Kendi stroke'larımızın Firebase echo'larını atla (biz zaten lokalda çizdik)
  const pendingLocalRef      = useRef(new Set());
  const lastFillStrokeRef    = useRef(null);
  // Fill için geri alma geçmişi: strokeId → { prevImageData }
  // (sadece lokal kullanıcı için — sayfa yenilenince kaybolur, kabul edilebilir)
  const fillHistoryRef       = useRef(new Map());

  // Throttle
  const lastPushTimeRef = useRef(0);
  const pendingSegRef   = useRef(null);
  const pushTimerRef    = useRef(null);
  const rafRef          = useRef(null);

  const colors = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#475569'];

  // ── Pozisyon hesapla ────────────────────────────────────────────────────────
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

  // ── Undo için tüm segmentleri yeniden çiz (smooth quadratic) ───────────────
  const redrawAll = useCallback((ctx, canvas) => {
    // 1. Önce arka planı temizle ve varsa en son Fill Snapshot'ını bas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (baseImageRef.current) {
      ctx.drawImage(baseImageRef.current, 0, 0);
    }

    // 2. Segmentleri strokeId'ye göre grupla (sıra korunarak)
    const order = [];
    const map   = new Map();
    for (const s of allSegmentsRef.current) {
      if (undoneStrokesRef.current.has(s.strokeId)) continue;
      if (!map.has(s.strokeId)) {
        map.set(s.strokeId, {
          points:   [{ x: s.x0, y: s.y0 }],
          color:    s.color,
          width:    s.width ?? 4,
          isEraser: s.isEraser,
        });
        order.push(s.strokeId);
      }
      map.get(s.strokeId).points.push({ x: s.x1, y: s.y1 });
    }
    // Her stroke'u smooth çiz
    for (const id of order) {
      const { points, color, width, isEraser } = map.get(id);
      drawSmoothStroke(ctx, points, color, width, isEraser);
    }
    // Snap canvas'ı da güncelle
    snapCanvasRef.current?.getContext('2d').drawImage(canvas, 0, 0);
  }, []);

  // ── Firebase throttled push (~60fps) ───────────────────────────────────────
  const pushSegment = useCallback((seg) => {
    const now = Date.now(), elapsed = now - lastPushTimeRef.current;
    if (elapsed >= 16) {                           // ~60fps
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
        }, 16 - elapsed);
      }
    }
  }, []);

  // ── Firebase listener ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // willReadFrequently: flood fill için getImageData performansı
    const ctx     = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width  = 500;
    canvas.height = 300;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Offscreen snapshot canvas (lokal önizleme için)
    const snap     = document.createElement('canvas');
    snap.width     = 500;
    snap.height    = 300;
    const snapCtx  = snap.getContext('2d');
    snapCtx.fillStyle = '#ffffff';
    snapCtx.fillRect(0, 0, 500, 300);
    snapCanvasRef.current = snap;

    const unsubscribe = onChildAdded(ref(rtdb, 'canvas/segments'), (snapshot) => {
      const seg = snapshot.val();
      if (!seg) return;

      // ── Flood Fill Snapshot ──
      if (seg.fillCanvas) {
        if (seg.strokeId === lastFillStrokeRef.current) {
          lastFillStrokeRef.current = null;
          allSegmentsRef.current    = [];
          undoneStrokesRef.current  = new Set();
          strokeBuffersRef.current  = new Map();
          
          // Kendi fill'imizi baseImageRef'e de kaydet ki Redraw bozulmasın
          const img = new Image();
          img.onload = () => { baseImageRef.current = img; };
          img.src = seg.imageData;
          return;
        }
        // Diğer kullanıcının fill'i
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          snapCtx.clearRect(0, 0, 500, 300);
          snapCtx.drawImage(canvas, 0, 0);
          baseImageRef.current = img; // Arka planı güncelle
        };
        img.src = seg.imageData;
        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        strokeBuffersRef.current = new Map();
        setHistory([]);
        return;
      }

      // ── Clear ──
      if (seg.clear) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        snapCtx.fillStyle = '#ffffff';
        snapCtx.fillRect(0, 0, 500, 300);
        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        strokeBuffersRef.current = new Map();
        return;
      }

      // ── Undo ──
      if (seg.undo) {
        // Fill geri alma: önceki canvas snapshot'ını geri yükle
        const fillData = fillHistoryRef.current.get(seg.strokeId);
        if (fillData) {
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            snapCtx.clearRect(0, 0, 500, 300);
            snapCtx.drawImage(canvas, 0, 0);
          };
          img.src = fillData.prevImageData;
          fillHistoryRef.current.delete(seg.strokeId);
          return;
        }
        // Normal stroke geri alma
        undoneStrokesRef.current.add(seg.strokeId);
        strokeBuffersRef.current.delete(seg.strokeId);
        redrawAll(ctx, canvas);
        return;
      }

      // ── Normal Segment ──
      allSegmentsRef.current.push(seg);
      if (undoneStrokesRef.current.has(seg.strokeId)) return;

      // Kendi stroke'umuzun echo'su → lokal zaten çizdi, sadece kaydet
      if (pendingLocalRef.current.has(seg.strokeId)) return;

      // Diğer kullanıcının segmenti → incremental smooth çiz
      drawIncrementalSmooth(ctx, seg, strokeBuffersRef.current);
    });

    return () => {
      unsubscribe();
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [redrawAll]);

  // ── Çizim Başlat ───────────────────────────────────────────────────────────
  const startDraw = useCallback((e) => {
    if (!canvasRef.current || !snapCanvasRef.current) return;
    const pos = getPos(e);

    // Mevcut canvas state'ini snapshot'a kaydet
    const snapCtx = snapCanvasRef.current.getContext('2d');
    snapCtx.clearRect(0, 0, 500, 300);
    snapCtx.drawImage(canvasRef.current, 0, 0);

    lastPosRef.current          = pos;
    currentStrokePtsRef.current = [pos];

    const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    currentStrokeIdRef.current = strokeId;
    pendingLocalRef.current.add(strokeId);       // Bu stroke'un echo'larını atla

    setIsDrawing(true);
    setHistory(prev => [...prev, strokeId]);
  }, [getPos]);

  // ── Canvas Tıklama: Fill veya Draw ─────────────────────────────────────────
  const handleCanvasMouseDown = useCallback((e) => {
    if (isFillRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pos = getPos(e);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      // Fill öncesi canvas'ı kaydet (undo için)
      const prevTmp = document.createElement('canvas');
      prevTmp.width = canvas.width; prevTmp.height = canvas.height;
      prevTmp.getContext('2d').drawImage(canvas, 0, 0);
      const prevImageData = prevTmp.toDataURL('image/jpeg', 0.8);

      const filled = runFloodFill(ctx, canvas, pos.x, pos.y, colorRef.current);
      if (filled) {
        const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        lastFillStrokeRef.current = strokeId;

        // Lokal fillHistory'e ekle (undo bu ref'ten geri yükleyecek)
        fillHistoryRef.current.set(strokeId, { prevImageData });

        const postTmp = document.createElement('canvas');
        postTmp.width = canvas.width; postTmp.height = canvas.height;
        postTmp.getContext('2d').drawImage(canvas, 0, 0);
        push(ref(rtdb, 'canvas/segments'), {
          fillCanvas: true,
          imageData:  postTmp.toDataURL('image/jpeg', 0.8),
          strokeId,
        });

        allSegmentsRef.current   = [];
        undoneStrokesRef.current = new Set();
        strokeBuffersRef.current = new Map();
        
        // Base image'i güncelle
        const fillImg = new Image();
        fillImg.onload = () => { baseImageRef.current = fillImg; };
        fillImg.src = postTmp.toDataURL('image/jpeg', 0.8);

        setHistory(prev => [...prev, strokeId]);
        snapCanvasRef.current?.getContext('2d').drawImage(canvas, 0, 0);
      }
      }
    } else {
      startDraw(e);
    }
  }, [getPos, startDraw]);

  // ── Move & End ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDrawing) return;

    let lastThrottle = 0;

    const handleMove = (e) => {
      if (e.cancelable && e.type === 'touchmove') e.preventDefault();

      const now        = performance.now();
      const currentPos = getPos(e);

      // Nokta tamponuna ekle
      currentStrokePtsRef.current.push(currentPos);

      // ── LOKAL ANİK ÖNİZLEME: RAF + Snapshot Restore + Smooth Quadratic ──
      // Her frame'de: snapshot'a dön → tüm biriken noktaları smooth çiz
      // Sonuç: pürüzsüz, gerçek zamanlı, kesintisiz çizim
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        const snap   = snapCanvasRef.current;
        if (!canvas || !snap) return;
        const ctx = canvas.getContext('2d');
        // 1. Snapshot'a dön (snapshot = bu stroke öncesi canvas)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(snap, 0, 0);
        // 2. Tüm birikmiş noktaları quadratic curve ile çiz
        drawSmoothStroke(
          ctx,
          currentStrokePtsRef.current,
          colorRef.current,
          brushSizeRef.current,
          isEraserRef.current,
        );
      });

      // ── Firebase'e throttle (~60fps = 16ms) ──
      if (now - lastThrottle >= 16) {
        lastThrottle = now;
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
      setIsDrawing(false);

      // Çizim bitti: snap canvas'ı son haliyle güncelle
      const canvas = canvasRef.current;
      const snap   = snapCanvasRef.current;
      if (canvas && snap) {
        const snapCtx = snap.getContext('2d');
        snapCtx.clearRect(0, 0, 500, 300);
        snapCtx.drawImage(canvas, 0, 0);
      }

      // Son noktaları Douglas-Peucker ile sadeleştirip Firebase'e gönder
      const pts = currentStrokePtsRef.current;
      if (pts.length >= 2) {
        const simplified = douglasPeucker(pts, 1.5); // 1.5px tolerans (önceki 2.0'dan daha hassas)
        for (let i = 0; i < simplified.length - 1; i++) {
          push(ref(rtdb, 'canvas/segments'), {
            strokeId: currentStrokeIdRef.current,
            x0: simplified[i].x,     y0: simplified[i].y,
            x1: simplified[i + 1].x, y1: simplified[i + 1].y,
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

      // Firebase echo'larını 2 saniye boyunca atla
      const strokeId = currentStrokeIdRef.current;
      setTimeout(() => pendingLocalRef.current.delete(strokeId), 2000);
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
  }, [isDrawing, getPos, pushSegment]);

  // ── Temizle ────────────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    setHistory([]);
    allSegmentsRef.current    = [];
    undoneStrokesRef.current  = new Set();
    strokeBuffersRef.current  = new Map();
    set(ref(rtdb, 'canvas/segments'), null);
    push(ref(rtdb, 'canvas/segments'), { clear: true });
  }, []);

  // ── Geri Al ────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const lastId = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    push(ref(rtdb, 'canvas/segments'), { undo: true, strokeId: lastId });
  }, [history]);

  // ── Sohbete Gönder ─────────────────────────────────────────────────────────
  const handleSendToChat = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
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

  // ── UI Yardımcıları ────────────────────────────────────────────────────────
  const activeTool   = isFill ? 'fill' : isEraser ? 'eraser' : 'pen';
  const canvasCursor = isFill ? 'cursor-cell' : 'cursor-crosshair';

  // Aktif araç butonu: belirgin glow + ring ile görsel geri bildirim
    }`;

  // Renk seçimini yönet + Hafızaya ekle
  const handleColorPick = useCallback((newColor) => {
    setColor(newColor);
    setIsEraser(false);
    setIsFill(false);
    
    // RecentColors güncelle: Eğer zaten varsa öne çek, yoksa ekle ve sonuncuyu sil
    setRecentColors(prev => {
      const filtered = prev.filter(c => c !== newColor);
      return [newColor, ...filtered].slice(0, 4);
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-md p-4 sm:p-8 overflow-y-auto' : 'bg-white/80 backdrop-blur-sm rounded-[2rem] shadow-sm border border-purple-100/50 p-6'} flex flex-col items-center transition-all duration-300`}>
      <div className={`w-full ${isFullscreen ? 'max-w-5xl my-auto' : ''}`}>

        {/* ── Başlık + Kontrol Butonları ── */}
        <div className="w-full flex justify-between items-center mb-4">
          <h2 className={`font-bold ${isFullscreen ? 'text-white' : 'text-slate-700'}`}>
            Çizim Tahtamız 🎨
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullscreen(f => !f)}
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

        {/* ── Canvas ── */}
        <div className={`w-full border-2 ${isFullscreen ? 'border-slate-700 bg-slate-800 shadow-2xl' : 'border-dashed border-slate-200 bg-slate-50 shadow-inner'} rounded-2xl overflow-hidden mb-4 touch-none relative`}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onTouchStart={handleCanvasMouseDown}
            className={`w-full aspect-[5/3] ${canvasCursor} bg-white block`}
          />
        </div>

        {/* ── Alt Araç Çubuğu ── */}
        <div className="w-full flex flex-col gap-3">

          {/* Renk + Araç Seçici */}
          <div className={`flex justify-center flex-wrap gap-2 px-4 py-2 rounded-full shadow-sm items-center w-full ${isFullscreen ? 'bg-slate-800/80' : 'bg-white'}`}>

            {/* ── Renk Paleti — tıklayınca otomatik Kalem moduna girer ── */}
            {colors.map(c => {
              const isPenActive = activeTool === 'pen' && color === c;
              return (
                <button
                  key={c}
                  onClick={() => handleColorPick(c)}
                  className={[
                    'w-8 h-8 rounded-full transition-all duration-200 shadow-sm flex-shrink-0',
                    isPenActive
                      ? 'scale-125 ring-2 ring-offset-1 shadow-md'
                      : 'border-2 border-transparent hover:scale-110',
                  ].join(' ')}
                  style={{
                    backgroundColor: c,
                    ...(isPenActive ? { ringColor: c, boxShadow: `0 0 0 2px white, 0 0 0 4px ${c}` } : {}),
                  }}
                />
              );
            })}

            {/* Renk Çarkı (Özel Renk) */}
            <div
              className={[
                'relative w-8 h-8 rounded-full transition-all duration-200 shadow-sm flex-shrink-0 overflow-hidden cursor-pointer',
                activeTool === 'pen' && !colors.includes(color)
                  ? 'scale-125 ring-2 ring-offset-1 ring-slate-400 shadow-md'
                  : 'border-2 border-transparent hover:scale-110',
              ].join(' ')}
              style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
            >
              <input
                type="color"
                value={colors.includes(color) ? '#000000' : color}
                onChange={(e) => handleColorPick(e.target.value)}
                className="absolute inset-0 w-[150%] h-[150%] top-[-25%] left-[-25%] opacity-0 cursor-pointer"
              />
            </div>

            <div className={`w-[2px] h-6 mx-1 rounded-full hidden sm:block ${isFullscreen ? 'bg-slate-700' : 'bg-slate-200'}`} />

            {/* ── Renklilik Hafızası (Son 4 Renk) ── */}
            <div className="flex gap-1.5 items-center px-2 py-1 bg-slate-50/50 rounded-full border border-slate-100/50">
              {recentColors.map((c, i) => {
                const isActive = activeTool === 'pen' && color === c;
                return (
                  <button
                    key={`${c}-${i}`}
                    onClick={() => handleColorPick(c)}
                    className={`w-6 h-6 rounded-full transition-all duration-200 shadow-sm border ${isActive ? 'scale-110 ring-2 ring-offset-1 ring-slate-300 border-white' : 'border-slate-100 hover:scale-105'}`}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>

            <div className={`w-[2px] h-6 mx-1 rounded-full hidden sm:block ${isFullscreen ? 'bg-slate-700' : 'bg-slate-200'}`} />

            {/* Boya Kovası */}
            <button
              onClick={() => { setIsFill(true); setIsEraser(false); }}
              className={toolBtn(isFill, isFullscreen)}
              title="Boya Kovası"
            >
              <PaintBucket size={16} />
            </button>

            {/* Silgi */}
            <button
              onClick={() => { setIsEraser(true); setIsFill(false); }}
              className={toolBtn(isEraser, isFullscreen)}
              title="Silgi"
            >
              <Eraser size={16} />
            </button>
          </div>

          {/* ── Kalem butonu kaldırıldı — renge tıklamak zaten kalem modunu aktif eder ── */}
        </div>

          {/* Fırça Boyutu Slider */}
          <div className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl shadow-sm ${isFullscreen ? 'bg-slate-800/80' : 'bg-white'}`}>
            {/* Canlı önizleme noktası */}
            <div
              className="flex-shrink-0 rounded-full transition-all duration-150"
              style={{
                width:           Math.max(6, brushSize),
                height:          Math.max(6, brushSize),
                backgroundColor: isEraser ? '#94a3b8' : color,
                opacity:         0.85,
                minWidth:        6,
                minHeight:       6,
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
