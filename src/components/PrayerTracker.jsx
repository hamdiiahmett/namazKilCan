import React, { useEffect, useState } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, set } from 'firebase/database';
import { format } from 'date-fns';
import { Check } from 'lucide-react';

const PRAYERS = [
  { id: 'Fajr', label: 'Sabah' },
  { id: 'Dhuhr', label: 'Öğle' },
  { id: 'Asr', label: 'İkindi' },
  { id: 'Maghrib', label: 'Akşam' },
  { id: 'Isha', label: 'Yatsı' }
];

const users = [
  { id: 'zenep', name: 'Zenepcan', city: 'Balikesir' },
  { id: 'amet', name: 'Ametcan', city: 'Ankara' }
];

export default function PrayerTracker() {
  const [timings, setTimings] = useState({ zenep: null, amet: null });
  const [prayerState, setPrayerState] = useState({});
  const [loading, setLoading] = useState(true);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    // Fetch API
    const fetchTimings = async () => {
      try {
        const [resZ, resA] = await Promise.all([
          fetch(`https://api.aladhan.com/v1/timingsByCity?city=Balikesir&country=Turkey&method=13`),
          fetch(`https://api.aladhan.com/v1/timingsByCity?city=Ankara&country=Turkey&method=13`)
        ]);
        const dataZ = await resZ.json();
        const dataA = await resA.json();
        setTimings({
          zenep: dataZ.data.timings,
          amet: dataA.data.timings
        });
      } catch (err) {
        console.error("Prayer API error", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTimings();
  }, []);

  useEffect(() => {
    // DB dinleyicisi
    const todayRef = ref(rtdb, `prayers/${todayStr}`);
    const unsubscribe = onValue(todayRef, (snapshot) => {
      if (snapshot.exists()) {
        setPrayerState(snapshot.val());
      } else {
        setPrayerState({});
      }
    });

    return () => unsubscribe();
  }, [todayStr]);

  const togglePrayer = (userId, prayerId) => {
    const currentVal = prayerState[userId]?.[prayerId] || false;
    set(ref(rtdb, `prayers/${todayStr}/${userId}/${prayerId}`), !currentVal);
  };

  if (loading) return <div className="text-center p-6 text-pink-300 animate-pulse font-medium">Vakitler yükleniyor... ⏳</div>;

  return (
    <div className="bg-white/80 backdrop-blur-sm p-6 rounded-[2rem] shadow-sm border border-orange-100/50">
      <h2 className="text-xl font-bold text-slate-700 mb-6 text-center">Bugünün Namazları 🕋</h2>
      
      <div className="flex flex-col sm:flex-row gap-6 justify-between">
        {users.map(u => (
          <div key={u.id} className="flex-1 bg-gradient-to-br from-white to-pink-50/50 p-4 rounded-2xl border border-pink-100 shadow-sm">
            <h3 className="font-semibold text-pink-500 mb-4 text-center text-lg">{u.name} ({u.city})</h3>
            <div className="space-y-3">
              {PRAYERS.map(p => {
                const isDone = prayerState[u.id]?.[p.id];
                const timeStr = timings[u.id]?.[p.id] || '--:--';
                
                return (
                  <div key={p.id} className="flex items-center justify-between bg-white p-3 rounded-xl shadow-sm border border-slate-50 transition-colors hover:border-pink-200">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-700">{p.label}</span>
                      <span className="text-xs text-slate-400 font-mono">{timeStr}</span>
                    </div>
                    <button
                      onClick={() => togglePrayer(u.id, p.id)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shadow-inner 
                        ${isDone 
                          ? 'bg-gradient-to-tr from-green-400 to-emerald-300 shadow-green-200 text-white scale-110' 
                          : 'bg-slate-100 hover:bg-slate-200 text-transparent border border-slate-200'}`}
                    >
                      <Check size={18} strokeWidth={3} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
