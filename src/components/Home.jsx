import React, { useState, useEffect, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, onChildAdded, onChildChanged, update } from 'firebase/database';
import { ChevronLeft, ChevronRight, X, Trash2, Image, Sparkles } from 'lucide-react';
import { format } from 'date-fns';

export default function Home({ currentUser }) {
  const [images, setImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    const chatRef = ref(rtdb, 'chat/messages');

    const unsubAdded = onChildAdded(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val || val.type !== 'image' || val.isDeleted) return;
      const img = { id: snapshot.key, ...val };
      setImages(prev => {
        if (prev.some(m => m.id === snapshot.key)) return prev;
        return [img, ...prev].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
    });

    const unsubChanged = onChildChanged(chatRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      if (val.isDeleted) {
        setImages(prev => prev.filter(m => m.id !== snapshot.key));
        // Eğer lightbox'ta siliniyorsa kapat
        setLightboxIndex(null);
      } else if (val.type === 'image') {
        setImages(prev => prev.map(m => m.id === snapshot.key ? { id: snapshot.key, ...val } : m));
      }
    });

    return () => { unsubAdded(); unsubChanged(); };
  }, []);

  // ── Resim silme ──────────────────────────────────────────────────────────
  const handleDelete = useCallback((e, imgId) => {
    e.stopPropagation(); // Lightbox açılmasını engelle
    const msgRef = ref(rtdb, `chat/messages/${imgId}`);
    update(msgRef, { isDeleted: true });
  }, []);

  // Kişi bu resmi silebilir mi?
  const canDelete = (img) => currentUser && img.senderId === currentUser;

  const openLightbox  = (index) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const showPrev = (e) => {
    e.stopPropagation();
    if (lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
  };
  const showNext = (e) => {
    e.stopPropagation();
    if (lightboxIndex < images.length - 1) setLightboxIndex(lightboxIndex + 1);
  };

  const latestImage   = images[0];
  const galleryImages = images.slice(1);

  return (
    <div className="flex flex-col h-full w-full max-w-[500px] mx-auto overflow-y-auto px-4 py-4 space-y-6 pb-24">

      {/* ── Hoşgeldiniz Mesajı ── */}
      <div className="text-center space-y-2 mt-2 animate-slide-up">
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">🌸</span>
          <h1 className="text-2xl font-extrabold tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #ec4899, #f472b6, #f59e0b)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Hoşgeldiniz
          </h1>
          <span className="text-2xl">🌸</span>
        </div>
        <p className="text-sm font-medium text-slate-400 flex items-center justify-center gap-1.5">
          <span>🌷</span> Ametcan & Zenepcan <span>🌿</span>
        </p>
      </div>

      {/* ── Öne Çıkan Son Resim ── */}
      {latestImage ? (
        <div className="space-y-2 animate-fade-in">
          <div className="flex items-center gap-2 pl-1">
            <Sparkles size={14} className="text-amber-400" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">En Son Paylaşılan</h2>
          </div>
          <div
            onClick={() => openLightbox(0)}
            className="w-full aspect-[4/3] bg-slate-50 rounded-3xl overflow-hidden shadow-lg shadow-pink-100/30 border-2 border-white cursor-pointer relative group"
          >
            <img
              src={latestImage.imageUrl}
              alt="Latest"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
              <span className="text-white text-xs font-medium flex items-center gap-1">
                <Image size={12} /> Büyütmek için tıkla
              </span>
            </div>
            {latestImage.timestamp && (
              <div className="absolute top-3 right-3 bg-black/40 text-white text-[10px] px-2.5 py-1 rounded-xl backdrop-blur-md font-medium">
                {format(new Date(latestImage.timestamp), 'dd MMM HH:mm')}
              </div>
            )}
            {/* Silme Butonu — sadece sahip */}
            {canDelete(latestImage) && (
              <button
                onClick={(e) => handleDelete(e, latestImage.id)}
                className="absolute top-3 left-3 bg-black/40 hover:bg-red-500/80 text-white p-2 rounded-full backdrop-blur-md transition-all opacity-0 group-hover:opacity-100 z-10 active:scale-90"
                title="Resmi Sil"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full py-14 flex flex-col items-center justify-center text-slate-400 glass rounded-3xl border-2 border-dashed border-pink-200/50 animate-fade-in">
          <span className="text-4xl mb-3">🖼️</span>
          <p className="text-sm font-medium">Henüz bir anı paylaşılmamış.</p>
          <p className="text-xs text-slate-300 mt-1">Çizim yapıp sohbete gönderin! 🎨</p>
        </div>
      )}

      {/* ── Thumbnail Galerisi ── */}
      {galleryImages.length > 0 && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 pl-1">
            <span className="text-sm">🎨</span>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Önceki Çizimler</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {galleryImages.map((img, idx) => (
              <div
                key={img.id}
                onClick={() => openLightbox(idx + 1)}
                className="aspect-square bg-slate-50 rounded-2xl overflow-hidden shadow-sm shadow-pink-100/30 border-2 border-white cursor-pointer relative group transition-transform duration-200 hover:scale-[1.03]"
              >
                <img
                  src={img.imageUrl}
                  alt="Thumbnail"
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/15 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

                {/* Silme Butonu */}
                {canDelete(img) && (
                  <button
                    onClick={(e) => handleDelete(e, img.id)}
                    className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-red-500 text-white p-1.5 rounded-full backdrop-blur-md transition-all opacity-0 group-hover:opacity-100 shadow-md z-10 active:scale-90"
                    title="Resmi Sil"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxIndex !== null && images[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[100000] bg-black/95 backdrop-blur-sm flex items-center justify-center pointer-events-auto touch-none animate-fade-in"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-6 right-6 text-white p-2.5 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-all z-50 active:scale-90"
          >
            <X size={22} />
          </button>

          {/* Lightbox'ta da silme butonu */}
          {canDelete(images[lightboxIndex]) && (
            <button
              onClick={(e) => handleDelete(e, images[lightboxIndex].id)}
              className="absolute top-6 left-6 text-white p-2.5 bg-black/40 hover:bg-red-500/80 rounded-full backdrop-blur-md transition-all z-50 active:scale-90"
              title="Resmi Sil"
            >
              <Trash2 size={18} />
            </button>
          )}

          {lightboxIndex > 0 && (
            <button
              onClick={showPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white p-3 bg-black/50 hover:bg-black/70 rounded-full backdrop-blur-md transition-all active:scale-95 z-50"
            >
              <ChevronLeft size={28} />
            </button>
          )}

          <div
            className="relative w-full max-w-4xl h-full max-h-screen p-4 flex items-center justify-center px-16 sm:px-20"
            onClick={(e) => e.stopPropagation()}
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

          {lightboxIndex < images.length - 1 && (
            <button
              onClick={showNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white p-3 bg-black/50 hover:bg-black/70 rounded-full backdrop-blur-md transition-all active:scale-95 z-50"
            >
              <ChevronRight size={28} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
