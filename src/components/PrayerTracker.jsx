import React, { useEffect, useState, useCallback, memo, useMemo } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, set } from 'firebase/database';
import { format } from 'date-fns';
import { Check, Sun, Sunrise, Cloud, Sunset, Moon } from 'lucide-react';

const PRAYERS = [
  { id: 'Fajr', label: 'Sabah', Icon: Sunrise, gradient: 'from-amber-400 to-orange-400', lightBg: 'bg-amber-50', iconColor: 'text-amber-500' },
  { id: 'Dhuhr', label: 'Öğle', Icon: Sun, gradient: 'from-yellow-400 to-amber-400', lightBg: 'bg-yellow-50', iconColor: 'text-yellow-500' },
  { id: 'Asr', label: 'İkindi', Icon: Cloud, gradient: 'from-sky-400 to-blue-400', lightBg: 'bg-sky-50', iconColor: 'text-sky-500' },
  { id: 'Maghrib', label: 'Akşam', Icon: Sunset, gradient: 'from-rose-400 to-pink-400', lightBg: 'bg-rose-50', iconColor: 'text-rose-500' },
  { id: 'Isha', label: 'Yatsı', Icon: Moon, gradient: 'from-indigo-400 to-purple-400', lightBg: 'bg-indigo-50', iconColor: 'text-indigo-500' }
];

const users = [
  { id: 'zenep', name: 'Zenepcan', city: 'Balikesir', emoji: '🌷', gradient: 'from-pink-400 to-rose-400', lightBg: 'from-pink-50/50 to-rose-50/30', borderColor: 'border-pink-100' },
  { id: 'amet', name: 'Ametcan', city: 'Ankara', emoji: '🌿', gradient: 'from-sky-400 to-blue-400', lightBg: 'from-sky-50/50 to-blue-50/30', borderColor: 'border-sky-100' }
];

// Namaz kartı — sadece kendi verisi değişince re-render olur
const PrayerCard = memo(({ prayer, isDone, timeStr, onToggle }) => (
  <div className={`flex items-center justify-between p-3.5 rounded-2xl transition-all duration-300 border ${
    isDone 
      ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-100 shadow-sm shadow-green-100/50' 
      : 'bg-white/80 border-slate-100/80 hover:border-pink-100'
  }`}>
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
        isDone ? 'bg-green-100' : prayer.lightBg
      }`}>
        <prayer.Icon size={18} className={isDone ? 'text-green-500' : prayer.iconColor} strokeWidth={2} />
      </div>
      <div className="flex flex-col">
        <span className={`font-semibold text-sm transition-colors ${isDone ? 'text-green-600' : 'text-slate-700'}`}>
          {prayer.label}
        </span>
        <span className="text-[11px] text-slate-400 font-mono tracking-wider">{timeStr}</span>
      </div>
    </div>
    <button
      onClick={onToggle}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 ${
        isDone
          ? 'bg-gradient-to-tr from-green-400 to-emerald-400 shadow-md shadow-green-200/50 text-white scale-110'
          : 'bg-slate-100 hover:bg-pink-100 text-transparent border border-slate-200 hover:border-pink-200'
      }`}
    >
      <Check size={16} strokeWidth={3} className={isDone ? 'text-white' : ''} />
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

  const completedCount = useMemo(() => {
    return PRAYERS.filter(p => prayerState?.[p.id]).length;
  }, [prayerState]);

  return (
    <div className={`flex-1 bg-gradient-to-br ${user.lightBg} p-4 rounded-2xl border ${user.borderColor} shadow-sm transition-all`}>
      {/* User header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{user.emoji}</span>
          <div>
            <h3 className="font-bold text-slate-700 text-sm">{user.name}</h3>
            <span className="text-[10px] text-slate-400 font-medium">{user.city}</span>
          </div>
        </div>
        {/* Progress */}
        <div className="flex items-center gap-1.5">
          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${user.gradient} transition-all duration-500`}
              style={{ width: `${(completedCount / 5) * 100}%` }}
            />
          </div>
          <span className="text-[10px] font-bold text-slate-400">{completedCount}/5</span>
        </div>
      </div>

      {/* Prayer cards */}
      <div className="space-y-2">
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-3 animate-pulse">
        <Moon size={32} className="text-pink-300" />
        <span className="text-sm font-medium text-pink-300">Vakitler yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="glass p-5 rounded-[2rem] shadow-sm border border-pink-100/50 mx-2 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-center gap-2 mb-5">
        <span className="text-xl">🕋</span>
        <h2 className="text-lg font-bold text-slate-700">Bugünün Namazları</h2>
        <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
          {format(new Date(), 'dd MMM')}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between">
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
