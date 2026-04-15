import React, { useEffect, useState, useCallback, memo, useMemo } from 'react';
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

// Namaz kartı — sadece kendi verisi değişince re-render olur
const PrayerCard = memo(({ prayer, isDone, timeStr, onToggle }) => (
  <div className="flex items-center justify-between bg-white p-3 rounded-xl shadow-sm border border-slate-50 transition-colors hover:border-pink-200">
    <div className="flex flex-col">
      <span className="font-medium text-slate-700">{prayer.label}</span>
      <span className="text-xs text-slate-400 font-mono">{timeStr}</span>
    </div>
    <button
      onClick={onToggle}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shadow-inner 
        ${isDone 
          ? 'bg-gradient-to-tr from-green-400 to-emerald-300 shadow-green-200 text-white scale-110' 
          : 'bg-slate-100 hover:bg-slate-200 text-transparent border border-slate-200'}`}
    >
      <Check size={18} strokeWidth={3} />
    </button>
  </div>
));
PrayerCard.displayName = 'PrayerCard';

// Kullanıcı paneli — sadece kendi verisi değişince re-render olur
const UserPanel = memo(({ user, timings, prayerState, todayStr }) => {
  const togglePrayer = useCallback((prayerId) => {
    const currentVal = prayerState?.[prayerId] || false;
    set(ref(rtdb, `prayers/${todayStr}/${user.id}/${prayerId}`), !currentVal);
  }, [prayerState, todayStr, user.id]);

  return (
    <div className="flex-1 bg-gradient-to-br from-white to-pink-50/50 p-4 rounded-2xl border border-pink-100 shadow-sm">
      <h3 className="font-semibold text-pink-500 mb-4 text-center text-lg">{user.name} ({user.city})</h3>
      <div className="space-y-3">
        {PRAYERS.map(p => (
          <PrayerCard
            key={p.id}
            prayer={p}
            isDone={prayerState?.[p.id] || false}
            timeStr={timings?.[p.id] || '--:--'}
            onToggle={() => togglePrayer(p.id)}
          />
        ))}
      </div>
    </div>
  );
});
UserPanel.displayName = 'UserPanel';

export default function PrayerTracker() {
  const [timings, setTimings] = useState({ zenep: null, amet: null });
  const [prayerState, setPrayerState] = useState({});
  const [loading, setLoading] = useState(true);

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  useEffect(() => {
    // API cache: aynı gün tekrar fetch etme
    const cacheKey = `prayer_timings_${todayStr}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        setTimings(JSON.parse(cached));
        setLoading(false);
        return;
      } catch { /* cache bozuksa devam et */ }
    }

    const controller = new AbortController();

    const fetchTimings = async () => {
      try {
        const [resZ, resA] = await Promise.all([
          fetch(`https://api.aladhan.com/v1/timingsByCity?city=Balikesir&country=Turkey&method=13`, { signal: controller.signal }),
          fetch(`https://api.aladhan.com/v1/timingsByCity?city=Ankara&country=Turkey&method=13`, { signal: controller.signal })
        ]);
        const dataZ = await resZ.json();
        const dataA = await resA.json();
        const result = {
          zenep: dataZ.data.timings,
          amet: dataA.data.timings
        };
        setTimings(result);
        sessionStorage.setItem(cacheKey, JSON.stringify(result));
      } catch (err) {
        if (err.name !== 'AbortError') {
          // Sessiz geç — kullanıcıyı rahatsız etme
        }
      } finally {
        setLoading(false);
      }
    };
    fetchTimings();

    return () => controller.abort();
  }, [todayStr]);

  useEffect(() => {
    const todayRef = ref(rtdb, `prayers/${todayStr}`);
    const unsubscribe = onValue(todayRef, (snapshot) => {
      setPrayerState(snapshot.exists() ? snapshot.val() : {});
    });

    return () => unsubscribe();
  }, [todayStr]);

  if (loading) return <div className="text-center p-6 text-pink-300 animate-pulse font-medium">Vakitler yükleniyor... ⏳</div>;

  return (
    <div className="bg-white/80 backdrop-blur-sm p-6 rounded-[2rem] shadow-sm border border-orange-100/50">
      <h2 className="text-xl font-bold text-slate-700 mb-6 text-center">Bugünün Namazları 🕋</h2>
      
      <div className="flex flex-col sm:flex-row gap-6 justify-between">
        {users.map(u => (
          <UserPanel
            key={u.id}
            user={u}
            timings={timings[u.id]}
            prayerState={prayerState[u.id]}
            todayStr={todayStr}
          />
        ))}
      </div>
    </div>
  );
}
