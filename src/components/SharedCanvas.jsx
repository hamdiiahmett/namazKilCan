import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, onValue, push, set, serverTimestamp } from 'firebase/database';
import { 
  Trash2, 
  Eraser, 
  Undo2, 
  Redo2, 
  Send, 
  Maximize, 
  X, 
  PaintBucket, 
  MousePointer2 
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
//  PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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

const SharedCanvas = memo(function SharedCanvas({ currentUser }) {
  // --- REFS ---
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const pointsRef = useRef([]);
  const isDrawingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);
  const strokeIdRef = useRef(null);

  // --- STATE ---
  const [slots, setSlots] = useState(['#fb7185', '#38bdf8', '#34d399', '#fbbf24']);
  const [activeSlot, setActiveSlot] = useState(0);
  const [tool, setTool] = useState('pencil'); // 'pencil', 'eraser', 'fill'
  const [brushSize, setBrushSize] = useState(5);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // --- DERIVED ---
  const currentColor = slots[activeSlot];

  // --- FUNCTIONS ---

  const saveToUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack(prev => [...prev.slice(-19), imageData]); // Keep last 20
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Save current to Redo before applying Undo
    const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setRedoStack(prev => [...prev.slice(-19), currentData]);

    const lastData = undoStack[undoStack.length - 1];
    ctx.putImageData(lastData, 0, 0);
    setUndoStack(prev => prev.slice(0, -1));

    // Sync full canvas to Firebase for the other user
    push(ref(rtdb, 'canvas/segments'), {
      type: 'snapshot',
      data: canvas.toDataURL('image/png'),
      sender: currentUser
    });
  }, [undoStack, currentUser]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Save current to Undo before applying Redo
    const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack(prev => [...prev.slice(-19), currentData]);

    const nextData = redoStack[redoStack.length - 1];
    ctx.putImageData(nextData, 0, 0);
    setRedoStack(prev => prev.slice(0, -1));

    // Sync full canvas to Firebase
    push(ref(rtdb, 'canvas/segments'), {
      type: 'snapshot',
      data: canvas.toDataURL('image/png'),
      sender: currentUser
    });
  }, [redoStack, currentUser]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    saveToUndo();
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    set(ref(rtdb, 'canvas/segments'), null);
    push(ref(rtdb, 'canvas/segments'), { type: 'clear' });
  }, [saveToUndo]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
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

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const syncToFirebase = (seg) => {
    const now = Date.now();
    if (now - lastSyncTimeRef.current < 40) return; // 40ms throttle
    lastSyncTimeRef.current = now;
    push(ref(rtdb, 'canvas/segments'), { ...seg, strokeId: strokeIdRef.current });
  };

  const drawLocal = (p1, p2, p3, isSync = true) => {
    const ctx = contextRef.current;
    if (!ctx) return;

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
    }

    ctx.beginPath();
    if (!p3) {
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    } else {
      const midX = (p2.x + p3.x) / 2;
      const midY = (p2.y + p3.y) / 2;
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(p2.x, p2.y, midX, midY);
    }
    ctx.stroke();

    if (isSync) {
      syncToFirebase({
        type: 'draw',
        tool,
        color: currentColor,
        size: brushSize,
        p1, p2, p3
      });
    }
  };

  // --- EVENT HANDLERS ---

  const startDrawing = (e) => {
    const coords = getCoordinates(e);
    if (tool === 'fill') {
      saveToUndo();
      if (runFloodFill(contextRef.current, canvasRef.current, coords.x, coords.y, currentColor)) {
        push(ref(rtdb, 'canvas/segments'), {
          type: 'snapshot',
          data: canvasRef.current.toDataURL('image/png'),
          sender: currentUser
        });
      }
      return;
    }

    saveToUndo();
    isDrawingRef.current = true;
    strokeIdRef.current = Math.random().toString(36).substring(7);
    pointsRef.current = [coords];
  };

  const draw = (e) => {
    if (!isDrawingRef.current) return;
    const coords = getCoordinates(e);
    const pts = pointsRef.current;
    pts.push(coords);

    if (pts.length === 2) {
      drawLocal(pts[0], pts[1], null);
    } else if (pts.length > 2) {
      const p1 = pts[pts.length - 3];
      const p2 = pts[pts.length - 2];
      const p3 = pts[pts.length - 1];
      drawLocal(p1, p2, p3);
    }
  };

  const stopDrawing = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    pointsRef.current = [];
  };

  // --- INITIALIZATION & SYNC ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set internal resolution
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    contextRef.current = ctx;

    const canvasRefDb = ref(rtdb, 'canvas/segments');
    const unsubscribe = onChildAdded(canvasRefDb, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      if (data.type === 'clear') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (data.type === 'snapshot') {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = data.data;
      } else if (data.type === 'draw') {
        // External drawing sync
        const originalTool = tool;
        const originalColor = currentColor;
        const originalSize = brushSize;

        ctx.lineWidth = data.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (data.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = data.size * 4;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = data.color;
        }

        ctx.beginPath();
        if (!data.p3) {
          ctx.moveTo(data.p1.x, data.p1.y);
          ctx.lineTo(data.p2.x, data.p2.y);
        } else {
          const midX = (data.p2.x + data.p3.x) / 2;
          const midY = (data.p2.y + data.p3.y) / 2;
          ctx.moveTo(data.p1.x, data.p1.y);
          ctx.quadraticCurveTo(data.p2.x, data.p2.y, midX, midY);
        }
        ctx.stroke();

        // Restore local state after remote draw
        ctx.globalCompositeOperation = originalTool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = originalColor;
        ctx.lineWidth = originalTool === 'eraser' ? originalSize * 4 : originalSize;
      }
    });

    return () => unsubscribe();
  }, [currentColor, tool, brushSize]);

  const handleSlotClick = (index) => {
    setActiveSlot(index);
    if (tool === 'eraser') setTool('pencil');
  };

  const updateActiveSlotColor = (newColor) => {
    setSlots(prev => {
      const next = [...prev];
      next[activeSlot] = newColor;
      return next;
    });
    if (tool === 'eraser') setTool('pencil');
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

  return (
    <div className={`flex flex-col items-center w-full transition-all duration-300 ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-md p-4' : 'relative'}`}>
      
      {/* Header Info */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-4 px-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className={`text-xs font-medium ${isFullscreen ? 'text-slate-300' : 'text-slate-500'}`}>Shared Canvas Canlı</span>
        </div>
        <div className="flex gap-2">
           <button 
            onClick={() => setIsFullscreen(!isFullscreen)} 
            className={`p-2 rounded-xl transition-all ${isFullscreen ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white shadow-sm text-slate-400 hover:bg-slate-50 border border-slate-100'}`}
          >
            {isFullscreen ? <X size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className={`relative w-full max-w-4xl aspect-[4/3] sm:aspect-video bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100 touch-none group`}>
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className={`w-full h-full block cursor-crosshair ${tool === 'fill' ? 'cursor-alias' : ''}`}
        />
      </div>

      {/* Modern Control Panel */}
      <div className={`mt-6 w-full max-w-4xl flex flex-col gap-4 bg-white/80 backdrop-blur-lg p-5 rounded-[2.5rem] shadow-xl border border-white/50 mb-[80px] transition-all duration-500 ${isFullscreen ? 'translate-y-[-20px]' : ''}`}>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          
          {/* Left Side: Slots & Tools */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Color Slots */}
            <div className="flex bg-slate-100/50 p-1.5 rounded-2xl gap-1.5 border border-slate-200/40">
              {slots.map((c, i) => (
                <button
                  key={i}
                  onClick={() => handleSlotClick(i)}
                  className={`w-10 h-10 rounded-xl transition-all duration-300 relative ${activeSlot === i ? 'scale-110 shadow-lg ring-2 ring-white z-10' : 'opacity-60 hover:opacity-100 hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                >
                  {activeSlot === i && (
                    <div className="absolute inset-0 rounded-xl border-2 border-slate-800/20" />
                  )}
                </button>
              ))}
              <div className="relative w-10 h-10 rounded-xl overflow-hidden border-2 border-white shadow-sm hover:scale-105 transition-transform" style={{ background: 'conic-gradient(from 180deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}>
                <input 
                  type="color" 
                  value={currentColor} 
                  onChange={(e) => updateActiveSlotColor(e.target.value)} 
                  className="absolute inset-[-50%] w-[200%] h-[200%] cursor-pointer opacity-0"
                />
              </div>
            </div>

            <div className="h-8 w-[1px] bg-slate-200 mx-1" />

            {/* Tools */}
            <div className="flex gap-2">
              <button 
                onClick={() => setTool('pencil')} 
                className={`p-3 rounded-2xl transition-all ${tool === 'pencil' ? 'bg-slate-800 text-white shadow-lg scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                <MousePointer2 size={20} />
              </button>
              <button 
                onClick={() => setTool('fill')} 
                className={`p-3 rounded-2xl transition-all ${tool === 'fill' ? 'bg-slate-800 text-white shadow-lg scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                <PaintBucket size={20} />
              </button>
              <button 
                onClick={() => setTool('eraser')} 
                className={`p-3 rounded-2xl transition-all ${tool === 'eraser' ? 'bg-slate-800 text-white shadow-lg scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                <Eraser size={20} />
              </button>
            </div>
          </div>

          {/* Right Side: History & Actions */}
          <div className="flex flex-wrap items-center justify-end gap-3">
             <div className="flex gap-2 bg-slate-50 p-1 rounded-2xl border border-slate-100">
              <button onClick={handleUndo} disabled={undoStack.length === 0} className="p-3 text-slate-600 hover:bg-white hover:shadow-sm rounded-xl disabled:opacity-20 transition-all">
                <Undo2 size={20} />
              </button>
              <button onClick={handleRedo} disabled={redoStack.length === 0} className="p-3 text-slate-600 hover:bg-white hover:shadow-sm rounded-xl disabled:opacity-20 transition-all">
                <Redo2 size={20} />
              </button>
            </div>
            
            <button onClick={clearCanvas} className="p-3 bg-rose-50 text-rose-500 hover:bg-rose-100 rounded-2xl transition-all border border-rose-100 shadow-sm">
              <Trash2 size={20} />
            </button>

            <button onClick={handleSendToChat} className="flex items-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white rounded-2xl shadow-lg shadow-sky-200 transition-all font-bold text-sm">
              <span>Paylaş</span>
              <Send size={18} />
            </button>
          </div>
        </div>

        {/* Thickness Slider */}
        <div className="flex items-center gap-4 bg-slate-50/50 p-4 rounded-3xl border border-slate-100">
          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
             <div style={{ width: Math.max(2, brushSize / 2), height: Math.max(2, brushSize / 2), backgroundColor: currentColor, borderRadius: '50%' }} className="transition-all duration-200" />
          </div>
          <input 
            type="range" 
            min="1" 
            max="50" 
            value={brushSize} 
            onChange={(e) => setBrushSize(Number(e.target.value))} 
            className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
          />
          <span className="text-xs font-bold text-slate-400 w-10">{brushSize}px</span>
        </div>

      </div>
    </div>
  );
});

export default SharedCanvas;
