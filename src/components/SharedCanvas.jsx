import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, push, set, serverTimestamp, remove, update } from 'firebase/database';

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

const SharedCanvas = memo(function SharedCanvas({ currentUser }) {
  // --- REFS ---
  const canvasRef = useRef(null);
  const offscreenRef = useRef(null); 
  const contextRef = useRef(null);
  const pointsRef = useRef([]);
  const isDrawingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);
  const strokeIdRef = useRef(null);
  const redrawRequestRef = useRef(null);

  // --- CONFIG / PALETTE ---
  const mainColors = ['#ff808b', '#3bc1fb', '#34d399', '#fbbd23', '#a78bfa', '#475569'];

  // --- LOCAL STATE (ISOLATED) ---
  const [slots, setSlots] = useState(['#34d399', '#a78bfa', '#e2e8f0', '#e2e8f0']);
  const [activeSlot, setActiveSlot] = useState(1);
  const [tool, setTool] = useState('pencil'); 
  const [brushSize, setBrushSize] = useState(10);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // --- SYNC STATE ---
  const [redoStack, setRedoStack] = useState([]); 
  const [allSegments, setAllSegments] = useState([]);

  // --- DERIVED ---
  const currentColor = slots[activeSlot] || '#000000';

  // --- SIMPLE CONTINUOUS REDRAW LOGIC ---

  const drawStrokeGroup = useCallback((ctx, canvas, stroke) => {
    if (stroke.type === 'fill') {
        runFloodFill(ctx, canvas, stroke.x, stroke.y, stroke.color);
        return;
    }
    
    if (stroke.type === 'draw' && stroke.points && stroke.points.length > 0) {
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (stroke.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = stroke.size * 5; 
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color;
        }

        const pts = stroke.points;
        // --- STABLE & NATURAL ENGINE: Plain lineTo loop ---
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
    }
  }, []);

  const redrawAll = useCallback((segments) => {
    if (redrawRequestRef.current) cancelAnimationFrame(redrawRequestRef.current);

    redrawRequestRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
        const offscreen = offscreenRef.current;
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const octx = offscreen.getContext('2d', { willReadFrequently: true });

        const userStrokeGroups = {};
        segments.forEach(seg => {
            const uid = seg.senderId || 'Anonim';
            if (!userStrokeGroups[uid]) userStrokeGroups[uid] = [];
            
            if (seg.type === 'fill') {
                userStrokeGroups[uid].push({ ...seg });
            } else if (seg.type === 'draw') {
                let sGroup = userStrokeGroups[uid].find(g => g.strokeId === seg.strokeId && g.type === 'draw');
                if (!sGroup) {
                    sGroup = { type: 'draw', strokeId: seg.strokeId, tool: seg.tool, color: seg.color, size: seg.size, points: [] };
                    userStrokeGroups[uid].push(sGroup);
                }
                if (seg.curve) sGroup.points.push(seg.start, seg.control, seg.end);
                else if (seg.p1 && seg.p2) sGroup.points.push(seg.p1, seg.p2);
            }
        });

        const userIds = Object.keys(userStrokeGroups);
        const sortedIds = [
            ...userIds.filter(id => id !== currentUser),
            ...(userStrokeGroups[currentUser] ? [currentUser] : [])
        ];

        // Layered Rendering (Eraser isolation)
        sortedIds.forEach(uid => {
            octx.clearRect(0, 0, offscreen.width, offscreen.height);
            octx.globalCompositeOperation = 'source-over';
            userStrokeGroups[uid].forEach(stroke => drawStrokeGroup(octx, offscreen, stroke));
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(offscreen, 0, 0);
        });
    });
  }, [currentUser, drawStrokeGroup]);

  // --- SYNC INIT ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    contextRef.current = canvas.getContext('2d', { willReadFrequently: true });

    const segmentsRef = ref(rtdb, 'canvas/segments');
    const unsubscribe = onValue(segmentsRef, (snapshot) => {
      const data = snapshot.val();
      const segmentsArray = [];
      if (data) {
        Object.keys(data).sort().forEach(key => {
            if (data[key].type === 'clear') segmentsArray.length = 0;
            else segmentsArray.push({ ...data[key], key });
        });
      }
      setAllSegments(segmentsArray);
      redrawAll(segmentsArray);
    });

    return () => {
        unsubscribe();
        if (redrawRequestRef.current) cancelAnimationFrame(redrawRequestRef.current);
    };
  }, [redrawAll]);

  // --- ACTIONS ---

  const stopDrawing = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    pointsRef.current = [];
  }, []);

  useEffect(() => {
    const handleGlobalUp = () => stopDrawing();
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchend', handleGlobalUp, { passive: false });
    
    const fsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fsChange);

    return () => {
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchend', handleGlobalUp);
      document.removeEventListener('fullscreenchange', fsChange);
    };
  }, [stopDrawing]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
    } else {
        document.exitFullscreen?.();
    }
  };

  const handleUndo = async () => {
    if (allSegments.length === 0) return;
    const lastOp = allSegments[allSegments.length - 1];
    
    const updates = {};
    const targetStrokes = allSegments.filter(s => s.strokeId === lastOp.strokeId);
    
    if (targetStrokes.length > 0) {
        // Essential Deep Copy for shape fidelity
        const deepCopy = JSON.parse(JSON.stringify(targetStrokes));
        setRedoStack(prev => [...prev, { type: 'stroke', strokeId: lastOp.strokeId, segments: deepCopy }]);
        targetStrokes.forEach(seg => updates[seg.key] = null);
        await update(ref(rtdb, 'canvas/segments'), updates);
    }
  };

  const handleRedo = async () => {
    if (redoStack.length === 0) return;
    const toRestore = redoStack[redoStack.length - 1];
    for (const segData of toRestore.segments) {
        const { key, ...cleanData } = segData;
        await push(ref(rtdb, 'canvas/segments'), cleanData);
    }
    setRedoStack(prev => prev.slice(0, -1));
  };

  const handleSendToChat = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    push(ref(rtdb, 'chat/messages'), {
      type: 'image',
      imageUrl: canvas.toDataURL('image/png'),
      senderId: currentUser || 'Anonim',
      timestamp: serverTimestamp(),
    });
  };

  const clearCanvas = useCallback(async () => {
    if (allSegments.length === 0) return;
    const deepCopy = JSON.parse(JSON.stringify(allSegments));
    setRedoStack(prev => [...prev, { type: 'clear', segments: deepCopy }]);
    await set(ref(rtdb, 'canvas/segments'), null);
    await push(ref(rtdb, 'canvas/segments'), { type: 'clear' });
  }, [allSegments]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const syncToFirebase = (seg) => {
    const now = Date.now();
    if (now - lastSyncTimeRef.current < 50) return; 
    lastSyncTimeRef.current = now;
    push(ref(rtdb, 'canvas/segments'), { 
        ...seg, 
        strokeId: strokeIdRef.current, 
        senderId: currentUser || 'Anonim',
        timestamp: serverTimestamp()
    });
  };

  const startDrawing = (e) => {
    const coords = getCoordinates(e);
    if (!coords) return;
    
    if (tool === 'fill') {
      const fillData = { type: 'fill', x: coords.x, y: coords.y, color: currentColor, strokeId: Math.random().toString(36).substring(7), senderId: currentUser || 'Anonim' };
      push(ref(rtdb, 'canvas/segments'), fillData);
      setRedoStack([]);
      return;
    }
    
    isDrawingRef.current = true;
    strokeIdRef.current = Math.random().toString(36).substring(7);
    pointsRef.current = [coords];
    setRedoStack([]);

    const ctx = contextRef.current;
    if (ctx) {
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = brushSize * 5;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = currentColor;
        }
        // STABLE START: beginPath once
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y);
    }
  };

  const draw = (e) => {
    if (!isDrawingRef.current) return;
    const coords = getCoordinates(e);
    if (!coords) return;
    
    const ctx = contextRef.current;
    if (ctx) {
        // STABLE MOVE: Just lineTo and stroke, NO beginPath
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
    }

    const prev = pointsRef.current[pointsRef.current.length - 1];
    pointsRef.current.push(coords);
    syncToFirebase({ type: 'draw', tool, color: currentColor, size: brushSize, p1: prev, p2: coords });
  };

  const handlePaletteClick = (color) => {
    const nextSlots = [...slots];
    nextSlots[activeSlot] = color;
    setSlots(nextSlots);
    setTool('pencil');
  };

  const handleWheelChange = (color) => {
    const nextSlots = [...slots];
    nextSlots[activeSlot] = color;
    setSlots(nextSlots);
    setTool('pencil');
  };

  return (
    <div 
        className={`flex flex-col items-center w-full transition-all duration-300 ${isFullscreen ? 'fixed inset-0 z-[99999] bg-slate-900/95 backdrop-blur-md p-4 pt-10' : 'relative'}`}
    >
      
      {/* Header */}
      <div 
        className={`w-full max-w-4xl flex justify-between items-center mb-4 px-4 h-16 bg-white/50 backdrop-blur-sm rounded-3xl transition-all ${isFullscreen ? 'fixed top-4 left-4 right-4 z-[100000] max-w-none' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎨</span>
          <span className="text-lg font-bold text-slate-700 tracking-tight">Çizim Alanı</span>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-slate-50/50 p-1 rounded-xl">
            <button 
                onClick={handleUndo} 
                disabled={allSegments.length === 0}
                className="w-10 h-10 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-400 rounded-lg disabled:opacity-30 transition-all shadow-sm"
                title="Geri Al"
            >
                <span className="text-xl">↩️</span>
            </button>
            <button 
                onClick={handleRedo} 
                disabled={redoStack.length === 0}
                className="w-10 h-10 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-400 rounded-lg disabled:opacity-30 transition-all shadow-sm"
                title="İleri Al"
            >
                <span className="text-xl">↪️</span>
            </button>
          </div>

          <button 
            onClick={toggleFullscreen} 
            className="w-10 h-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-xl transition-all shadow-sm"
            title="Tam Ekran"
          >
            <span className="text-xl">🔳</span>
          </button>

          <button 
            onClick={handleSendToChat} 
            className="w-10 h-10 flex items-center justify-center bg-sky-50 hover:bg-sky-100 text-sky-500 rounded-xl transition-all shadow-sm shadow-sky-100"
            title="Sohbete Gönder"
          >
            <span className="text-xl">✈️</span>
          </button>
          
          <button 
            onClick={clearCanvas} 
            className="w-10 h-10 flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-400 rounded-xl transition-all"
            title="Temizle"
          >
            <span className="text-xl">🗑️</span>
          </button>
        </div>
      </div>

      {/* Canvas Area with Dashed Border */}
      <div className={`relative w-full max-w-4xl bg-white rounded-[2.5rem] p-6 shadow-xl-soft border-2 border-dashed border-slate-200 shadow-canvas transition-all ${isFullscreen ? 'flex-1 w-full max-w-none' : 'aspect-[4/3] sm:aspect-video'}`}>
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-full block cursor-crosshair rounded-[2rem]"
          style={{ touchAction: 'none' }} 
        />
      </div>

      {/* 3-Row Toolbar */}
      <div 
        className={`mt-8 w-full max-w-md flex flex-col gap-5 p-6 bg-white rounded-[3rem] shadow-toolbar border border-slate-50 transition-all ${isFullscreen ? 'fixed bottom-8 z-[100000]' : ''}`}
      >
        
        {/* Row 1: Fixed Colors + Wheel */}
        <div className="flex items-center justify-center gap-3">
          {mainColors.map(c => (
            <button
              key={c}
              onClick={() => handlePaletteClick(c)}
              className={`w-10 h-10 rounded-full transition-all border-4 ${currentColor === c ? 'border-indigo-400 scale-110 shadow-lg' : 'border-white hover:scale-105'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="w-[1px] h-6 bg-slate-100 mx-1" />
          <div className="relative w-10 h-10 rounded-full overflow-hidden border-4 border-white shadow-sm hover:scale-110 transition-all ring-2 ring-slate-100" style={{ background: 'conic-gradient(from 180deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}>
            <input 
              type="color" 
              value={currentColor} 
              onChange={(e) => handleWheelChange(e.target.value)} 
              className="absolute inset-[-50%] w-[200%] h-[200%] cursor-pointer opacity-0"
            />
          </div>
        </div>

        {/* Row 2: Independent Slots & Tools */}
        <div className="flex items-center justify-center gap-5">
           <div className="flex items-center gap-2 px-3 py-2 bg-slate-50/50 rounded-2xl">
              {slots.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setActiveSlot(i)}
                  className={`w-8 h-8 rounded-full transition-all border-4 ${activeSlot === i ? 'border-indigo-400 scale-125 shadow-md z-10' : 'border-white opacity-40 hover:opacity-100'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
           </div>

           <div className="w-[1px] h-8 bg-slate-200" />

           <div className="flex items-center gap-3">
              <button 
                onClick={() => setTool('fill')}
                className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${tool === 'fill' ? 'bg-indigo-50 text-indigo-500 scale-110 shadow-sm' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                title="Boya Kovası"
              >
                <span className="text-2xl">🪣</span>
              </button>
              <button 
                onClick={() => setTool('eraser')}
                className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${tool === 'eraser' ? 'bg-indigo-50 text-indigo-500 scale-110 shadow-sm' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                title="Silgi"
              >
                <span className="text-2xl">🧼</span>
              </button>
           </div>
        </div>

        {/* Row 3: Thickness Slider */}
        <div className="flex items-center gap-4 bg-slate-50/30 p-3 rounded-2xl">
           <div className="w-8 h-8 flex items-center justify-center">
             <div style={{ width: Math.max(2, brushSize/2), height: Math.max(2, brushSize/2), backgroundColor: currentColor, borderRadius: '50%' }} className="transition-all" />
           </div>
           <input 
            type="range" min="1" max="50" value={brushSize} 
            onChange={(e) => setBrushSize(Number(e.target.value))} 
            className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-pink-400"
          />
          <span className="text-[10px] font-bold text-slate-400 w-8">{brushSize}px</span>
        </div>

      </div>
      
      <style dangerouslySetInnerHTML={{ __html: `
        .shadow-xl-soft { box-shadow: 0 20px 60px -15px rgba(0,0,0,0.05); }
        .shadow-canvas { box-shadow: inset 0 0 40px rgba(0,0,0,0.02); }
        .shadow-toolbar { box-shadow: 0 10px 40px -10px rgba(0,0,0,0.08); }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 18px;
          width: 18px;
          border-radius: 50%;
          background: #f472b6;
          box-shadow: 0 2px 10px rgba(244, 114, 182, 0.4);
          cursor: pointer;
          border: 3px solid white;
          transition: all 0.2s;
        }
        input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.2); }
      `}} />

    </div>
  );
});

export default SharedCanvas;
