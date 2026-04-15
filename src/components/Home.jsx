import React, { useState, useEffect, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, onChildChanged, onChildRemoved } from 'firebase/database';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format } from 'date-fns';

export default function Home() {
  const [images, setImages] = useState([]);
  const [ lightboxIndex, setLightboxIndex ] = useState(null);

  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');

    // Sadece yeni eklenen resimleri al
    const unsubAdded = onChildAdded(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val || val.type !== 'image' || val.isDeleted) return;
      const img = { id: snapshot.key, ...val };
      setImages(prev => {
        if (prev.some(m => m.id === snapshot.key)) return prev;
        return [img, ...prev].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
    });

    // Silinen/düzenlenen resimleri güncelle
    const unsubChanged = onChildChanged(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      if (val.isDeleted) {
        setImages(prev => prev.filter(m => m.id !== snapshot.key));
      } else if (val.type === 'image') {
        const updated = { id: snapshot.key, ...val };
        setImages(prev => prev.map(m => m.id === snapshot.key ? updated : m));
      }
    });

    return () => {
      unsubAdded();
      unsubChanged();
    };
  }, []);

  const openLightbox = (index) => {
    setLightboxIndex(index);
  };

  const closeLightbox = () => {
    setLightboxIndex(null);
  };

  const showPrev = (e) => {
    e.stopPropagation();
    if (lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
    }
  };

  const showNext = (e) => {
    e.stopPropagation();
    if (lightboxIndex < images.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
    }
  };

  const latestImage = images[0];
  const galleryImages = images.slice(1);

  return (
    <div className="flex flex-col h-full w-full max-w-[500px] mx-auto overflow-y-auto px-4 py-4 space-y-6 pb-24">
      {/* ── Hoşgeldiniz Mesajı ── */}
      <div className="text-center space-y-1 mt-2">
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
          Hoşgeldiniz <span className="inline-block animate-pulse">🧡</span>
        </h1>
        <p className="text-sm font-medium text-slate-500">
          Ametcan & Zenepcan
        </p>
      </div>

      {/* ── Öne Çıkan Son Resim ── */}
      {latestImage ? (
        <div className="space-y-2">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">En Son Paylaşılan</h2>
          <div 
            onClick={() => openLightbox(0)}
            className="w-full aspect-[4/3] bg-slate-100 rounded-3xl overflow-hidden shadow-md border-2 border-white cursor-pointer relative group"
          >
            <img 
              src={latestImage.imageUrl} 
              alt="Latest"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
              <span className="text-white text-xs font-medium">Büyütmek için tıkla</span>
            </div>
            {latestImage.timestamp && (
              <div className="absolute top-3 right-3 bg-black/50 text-white text-[10px] px-2 py-1 rounded-lg backdrop-blur-md">
                 {format(new Date(latestImage.timestamp), 'dd MMM HH:mm')}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full py-12 flex flex-col items-center justify-center text-slate-400 bg-white/50 rounded-3xl border-2 border-dashed border-slate-200">
          <span className="text-4xl mb-2">🖼️</span>
          <p className="text-sm font-medium">Henüz bir anı paylaşılmamış.</p>
        </div>
      )}

      {/* ── Thumbnail Galerisi ── */}
      {galleryImages.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Önceki Çizimler</h2>
          <div className="grid grid-cols-3 gap-3">
            {galleryImages.map((img, idx) => (
              <div 
                key={img.id} 
                onClick={() => openLightbox(idx + 1)}
                className="aspect-square bg-slate-100 rounded-2xl overflow-hidden shadow-sm border-2 border-white cursor-pointer relative group"
              >
                <img 
                  src={img.imageUrl} 
                  alt="Thumbnail"
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Galeri Modu (Lightbox Modal) ── */}
      {lightboxIndex !== null && images[lightboxIndex] && (
        <div 
          className="fixed inset-0 z-[100000] bg-black/95 backdrop-blur-sm flex items-center justify-center pointer-events-auto touch-none"
          onClick={closeLightbox}
        >
          {/* Kapat Butonu */}
          <button 
            onClick={closeLightbox}
            className="absolute top-6 right-6 text-white p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-colors z-50"
          >
            <X size={24} />
          </button>

          {/* Önceki Butonu */}
          {lightboxIndex > 0 && (
            <button 
              onClick={showPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white p-3 bg-black/50 hover:bg-black/70 rounded-full backdrop-blur-md transition-all active:scale-95 z-50"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          {/* Resim Container */}
          <div 
            className="relative w-full max-w-4xl h-full max-h-screen p-4 flex items-center justify-center px-20"
            onClick={(e) => e.stopPropagation()} // resme tıklanınca kapanmasın
          >
            <img 
              src={images[lightboxIndex].imageUrl} 
              alt="Full size" 
              className="max-w-full max-h-full object-contain drop-shadow-2xl rounded-lg"
            />
            {images[lightboxIndex].timestamp && (
              <div className="absolute bottom-8 text-white/70 text-sm font-medium bg-black/50 px-4 py-2 rounded-full backdrop-blur-sm">
                {format(new Date(images[lightboxIndex].timestamp), 'dd MMMM yyyy, HH:mm')}
              </div>
            )}
          </div>

          {/* Sonraki Butonu */}
          {lightboxIndex < images.length - 1 && (
            <button 
              onClick={showNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white p-3 bg-black/50 hover:bg-black/70 rounded-full backdrop-blur-md transition-all active:scale-95 z-50"
            >
              <ChevronRight size={32} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
