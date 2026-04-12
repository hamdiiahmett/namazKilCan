import React, { useRef, useEffect, useState } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, push, set } from 'firebase/database';
import { Trash2 } from 'lucide-react';

export default function SharedCanvas() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState('#fb7185'); // pink
  
  const colors = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#475569'];

  const getPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Scale CSS pixels to Canvas internal pixels (500x300)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Fixed internal size for perfect sync precision on any screen
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
        return;
      }
      ctx.beginPath();
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = seg.width;
      ctx.stroke();
      ctx.closePath();
    });
    return () => unsubscribe();
  }, []);

  const startDraw = (e) => {
    setIsDrawing(true);
    setLastPos(getPos(e));
  };

  const draw = (e) => {
    if (!isDrawing) return;
    // For touch devices, prevent default scrolling behavior while drawing manually
    if (e.cancelable) e.preventDefault();
    
    const currentPos = getPos(e);
    
    // push segment to firebase
    push(ref(rtdb, 'canvas/segments'), {
      x0: lastPos.x,
      y0: lastPos.y,
      x1: currentPos.x,
      y1: currentPos.y,
      color: color,
      width: 4
    });
    
    setLastPos(currentPos);
  };

  const stopDraw = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    // Sil tuşu için rtdb değerini boşalt ve tüm cihazlardaki canvası temizlemek için bir 'clear' nesnesi yolla
    set(ref(rtdb, 'canvas/segments'), null);
    push(ref(rtdb, 'canvas/segments'), { clear: true });
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-[2rem] shadow-sm border border-purple-100/50 p-6 flex flex-col items-center">
      <div className="w-full flex justify-between items-center mb-4">
        <h2 className="font-bold text-slate-700">Ortak Çizim Tahtası 🎨</h2>
        <button onClick={clearCanvas} className="p-2 bg-purple-50 text-purple-500 rounded-full hover:bg-purple-100 transition-colors shadow-sm">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="w-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl overflow-hidden mb-5 touch-none relative shadow-inner">
        <canvas
          ref={canvasRef}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseOut={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
          className="w-full aspect-[5/3] cursor-crosshair bg-white block"
        />
      </div>

      <div className="flex justify-center gap-3 bg-white px-4 py-2 rounded-full shadow-sm">
        {colors.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-8 h-8 rounded-full border-2 transition-transform shadow-sm ${color === c ? 'scale-125 border-white shadow-md' : 'border-transparent'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}
