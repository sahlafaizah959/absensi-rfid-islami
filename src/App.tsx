import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, CheckCircle, XCircle, History, Download, Shield, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionType = 'Pagi' | 'Sore' | 'Malam';

interface Session {
  id: SessionType;
  label: string;
  limitHour: number;
  emoji: string;
  activeColor: string;
  activeBorder: string;
  activeText: string;
}

const SESSIONS: Session[] = [
  {
    id: 'Pagi',
    label: 'Sesi Pagi',
    limitHour: 9,
    emoji: '☀️',
    activeColor: 'bg-yellow-300',
    activeBorder: 'border-yellow-400',
    activeText: 'text-yellow-900',
  },
  {
    id: 'Sore',
    label: 'Sesi Sore',
    limitHour: 16,
    emoji: '🌤️',
    activeColor: 'bg-orange-300',
    activeBorder: 'border-orange-400',
    activeText: 'text-orange-900',
  },
  {
    id: 'Malam',
    label: 'Sesi Malam',
    limitHour: 19,
    emoji: '🌙',
    activeColor: 'bg-blue-800',
    activeBorder: 'border-blue-900',
    activeText: 'text-blue-100',
  },
];

interface Student {
  id: string;
  name: string;
  gender: 'L' | 'P';
}

interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  gender: 'L' | 'P';
  time: Date;
  session: SessionType;
  status: 'Tepat Waktu' | 'Terlambat';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionType>('Pagi');
  const [rfidInput, setRfidInput] = useState('');
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [lastScanned, setLastScanned] = useState<Student | null>(null);
  const [lastScanRecord, setLastScanRecord] = useState<AttendanceRecord | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; action: (() => void) | null }>({
    isOpen: false,
    action: null,
  });
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const indonesianVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // ── Keep RFID input focused ──────────────────────────────────────────────
  useEffect(() => {
    const focusInput = () => {
      if (isStarted && !authModal.isOpen && inputRef.current) {
        inputRef.current.focus();
      }
    };
    focusInput();
    const timeout = setTimeout(focusInput, 100);
    window.addEventListener('click', focusInput);
    return () => {
      window.removeEventListener('click', focusInput);
      clearTimeout(timeout);
    };
  }, [isStarted, authModal.isOpen]);

  // ── Real-time clock ──────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── PIN Auth helpers ─────────────────────────────────────────────────────
  const requireAuth = (action: () => void) => {
    setAuthModal({ isOpen: true, action });
    setPinInput('');
    setPinError(false);
  };

  const handlePinSubmit = () => {
    if (pinInput === '1972') {
      authModal.action?.();
      setAuthModal({ isOpen: false, action: null });
    } else {
      setPinError(true);
      setPinInput('');
      setTimeout(() => setPinError(false), 1000);
    }
  };

  // ── Initialize EasySpeech ──────────────────────────────────────────────────
  // ── Initialize Speech Synthesis Native ──
  useEffect(() => {
    const loadVoices = () => {
      // Memancing browser untuk memuat daftar suara ke memori
      window.speechSynthesis.getVoices();
    };

    loadVoices();
    // Event ini penting agar daftar suara terisi saat browser sudah siap
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // ── Audio init (unlocks speech synthesis on mobile) ──────────────────────
  const initAudio = () => {
    try {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance('');
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.error('Audio init failed', e);
    }
    setIsStarted(true);
  };

  // ── Text-to-speech ───────────────────────────────────────────────────────
  const speak = (name: string, status: string) => {
    try {
      // Cancel any ongoing speech to prevent overlapping
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      let text = '';
      if (status === 'Tepat Waktu') {
        text = `Masya Allah, ${name} tepat waktu!`;
      } else if (status === 'Terlambat') {
        text = `Ayo ${name}, besok lebih pagi ya!`;
      } else {
        text = name;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'id-ID';
      utterance.rate = 0.9;
      utterance.pitch = 1.1;

      // Find Indonesian voice
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        const indonesianVoice = voices.find(
          (voice) =>
            voice.name.toLowerCase().includes('google bahasa indonesia') ||
            voice.name.toLowerCase().includes('indonesian') ||
            voice.lang === 'id-ID'
        );

        if (indonesianVoice) {
          utterance.voice = indonesianVoice;
          console.log('Using Indonesian voice:', indonesianVoice.name);
        } else {
          console.warn('No Indonesian voice found. Using default voice with id-ID language.');
        }
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      console.error('Speech synthesis error:', error);
      setIsSpeaking(true);
      setTimeout(() => setIsSpeaking(false), 2000);
    }
  };

  // ── Core attendance logic (Firestore) ────────────────────────────────────
  const prosesAbsen = async (id_kartu: string) => {
    // Prevent spamming while a lookup is already in progress
    if (isLoading) return;
    setIsLoading(true);
    setNotification(null);

    try {
      // Query Firestore: collection "murid", document named after the RFID ID
      const docRef = doc(db, 'murid', id_kartu);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        setNotification('Kartu tidak terdaftar! ❌');
        setLastScanned(null);
        setLastScanRecord(null);
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      const data = docSnap.data();
      const student: Student = {
        id: id_kartu,
        name: data.nama as string,       // Firestore field: "nama"
        gender: data.gender as 'L' | 'P', // Firestore field: "gender"
      };

      // ── Double-tap guard: already scanned in this session? ──────────────
      const alreadyScanned = attendances.some(
        (a) => a.studentId === student.id && a.session === activeSession
      );

      if (alreadyScanned) {
        setNotification('Sudah Absen! 👍');
        setLastScanned(student);
        const existingRecord = attendances.find(
          (a) => a.studentId === student.id && a.session === activeSession
        );
        if (existingRecord) setLastScanRecord(existingRecord);
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // ── Calculate Tepat Waktu vs Terlambat ──────────────────────────────
      const now = new Date();
      const sessionConfig = SESSIONS.find((s) => s.id === activeSession)!;
      // Late if current hour is past the limit, OR exactly at the limit but minutes > 0
      const isLate =
        now.getHours() > sessionConfig.limitHour ||
        (now.getHours() === sessionConfig.limitHour && now.getMinutes() > 0);
      const status: 'Tepat Waktu' | 'Terlambat' = isLate ? 'Terlambat' : 'Tepat Waktu';

      const newRecord: AttendanceRecord = {
        id: Math.random().toString(36).substr(2, 9),
        studentId: student.id,
        studentName: student.name,
        gender: student.gender,
        time: now,
        session: activeSession,
        status,
      };

      setAttendances((prev) => [newRecord, ...prev]);
      setLastScanned(student);
      setLastScanRecord(newRecord);

      // ── Speak feedback ──────────────────────────────────────────────────
      speak(student.name, status);

      // Clear the scan display after 4 seconds
      setTimeout(() => {
        setLastScanned(null);
        setLastScanRecord(null);
      }, 4000);
    } catch (error) {
      console.error('Firestore error:', error);
      setNotification('Gagal membaca data! Coba lagi. ⚠️');
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  // ── RFID input handlers ──────────────────────────────────────────────────
  // RFID tags are 10 digits — do NOT auto-submit on character count.
  // The reader sends an Enter keystroke after the full ID.
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRfidInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const trimmed = rfidInput.trim();
      if (trimmed !== '') {
        prosesAbsen(trimmed);
        setRfidInput('');
      }
    }
  };

  // ── PDF export ───────────────────────────────────────────────────────────
  const downloadPDF = () => {
    const pdfDoc = new jsPDF();
    const sessionLabel = SESSIONS.find((s) => s.id === activeSession)?.label || activeSession;
    const dateStr = currentTime.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    pdfDoc.setFontSize(18);
    pdfDoc.text(`Laporan Kehadiran - ${sessionLabel}`, 14, 22);
    pdfDoc.setFontSize(12);
    pdfDoc.text(`Tanggal: ${dateStr}`, 14, 30);

    const tableData = attendances
      .filter((a) => a.session === activeSession)
      .map((record, index) => [
        index + 1,
        record.studentName,
        record.gender,
        record.time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        record.status,
      ]);

    autoTable(pdfDoc, {
      startY: 40,
      head: [['No', 'Nama Santri', 'L/P', 'Waktu Scan', 'Status']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] }, // Emerald-500
      styles: { font: 'helvetica', fontSize: 10 },
    });

    pdfDoc.save(`Absensi_${activeSession}_${currentTime.toISOString().split('T')[0]}.pdf`);
  };

  // ── Splash / Start screen ────────────────────────────────────────────────
  if (!isStarted) {
    return (
      <div className="min-h-screen bg-[#A8E6CF] flex items-center justify-center font-sans relative overflow-hidden">
        <div className="absolute top-10 left-10 text-6xl opacity-80 animate-bounce">☁️</div>
        <div
          className="absolute bottom-20 right-20 text-6xl opacity-80 animate-bounce"
          style={{ animationDelay: '1s' }}
        >
          ☁️
        </div>
        <div className="absolute top-20 right-10 text-8xl opacity-50">🕌</div>

        <motion.button
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={initAudio}
          className="bg-white hover:bg-gray-50 text-teal-800 font-bold text-3xl md:text-4xl py-8 px-12 rounded-full shadow-[0_10px_0_rgba(0,0,0,0.1)] flex items-center gap-4 z-10 transition-colors"
        >
          Mulai Absensi 🚀
        </motion.button>
      </div>
    );
  }

  // ── Main App ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-teal-50 font-sans text-teal-950 flex flex-col overflow-x-hidden">

      {/* Hidden RFID input — always focused, invisible to users */}
      <input
        ref={inputRef}
        type="text"
        value={rfidInput}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className="opacity-0 absolute -z-10 w-0 h-0"
        autoFocus
        aria-hidden="true"
        autoComplete="off"
      />

      {/* ── Header ── */}
      <header className="bg-[#A8E6CF] py-4 px-6 shadow-md flex justify-between items-center relative z-10">
        <div className="text-4xl animate-bounce">☁️</div>
        <h1 className="text-3xl md:text-5xl font-bold text-teal-800 tracking-wide text-center flex-1 drop-shadow-sm">
          Bani Mustofa
        </h1>
        <div className="text-4xl">🕌</div>
      </header>

      <main className="flex-grow container mx-auto px-4 py-8 max-w-5xl flex flex-col items-center gap-8">

        {/* ── Session Selector ── */}
        <section className="w-full">
          <div className="flex flex-wrap justify-center gap-4">
            {SESSIONS.map((session) => {
              const isActive = activeSession === session.id;
              return (
                <button
                  key={session.id}
                  onClick={() => requireAuth(() => setActiveSession(session.id))}
                  className={`relative overflow-hidden rounded-full px-8 py-4 transition-all duration-300 shadow-md hover:shadow-lg flex items-center gap-3 border-4 ${
                    isActive
                      ? `${session.activeColor} ${session.activeBorder} ${session.activeText} transform scale-105`
                      : 'bg-white border-transparent text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-3xl drop-shadow-sm">{session.emoji}</span>
                  <span className="text-2xl font-bold">{session.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Main Stage (Cloud Visual) ── */}
        <section className="relative w-full max-w-lg flex flex-col items-center justify-center min-h-[450px] mt-4">

          {/* Cloud background SVG */}
          <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
            <svg viewBox="0 0 24 24" fill="white" className="w-[160%] h-[160%] drop-shadow-2xl">
              <path d="M17.5 19c2.485 0 4.5-2.015 4.5-4.5 0-2.22-1.605-4.063-3.732-4.422C18.067 6.553 15.28 4 12 4c-3.28 0-6.067 2.553-6.268 6.078C3.605 10.437 2 12.28 2 14.5 2 16.985 4.015 19 6.5 19h11z" />
            </svg>
          </div>

          {/* Content inside cloud */}
          <div className="z-10 flex flex-col items-center text-center mt-4 w-full">
            <AnimatePresence mode="wait">

              {/* ── Loading state ── */}
              {isLoading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center gap-4"
                >
                  <div className="w-32 h-32 bg-teal-100 rounded-full flex items-center justify-center border-4 border-teal-300">
                    <Loader2 className="w-16 h-16 text-teal-500 animate-spin" />
                  </div>
                  <h2 className="text-3xl font-bold text-teal-800">Memproses...</h2>
                  <p className="text-teal-600 text-lg font-medium">Sedang membaca data santri ☁️</p>
                </motion.div>

              ) : lastScanned && lastScanRecord ? (
                /* ── Successful scan result ── */
                <motion.div
                  key="scanned"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center w-full"
                >
                  {/* Photo with gold glow */}
                  <div className="relative">
                    <img
                     src={`/foto_murid/${lastScanned.id}.jpg`}
                      onError={(e) => {
                        e.currentTarget.src = `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(lastScanned.name)}&backgroundColor=b6e3f4`;
                      }}
                      alt={lastScanned.name}
                      className="w-48 h-48 rounded-full border-4 border-yellow-400 object-cover bg-teal-50 shadow-[0_0_30px_rgba(250,204,21,0.6)]"
                    />

                    {/* Floating stars for on-time */}
                    {lastScanRecord.status === 'Tepat Waktu' && (
                      <>
                        <div className="absolute -top-4 -left-4 text-4xl animate-bounce" style={{ animationDelay: '0s' }}>⭐</div>
                        <div className="absolute -top-8 right-0 text-5xl animate-bounce" style={{ animationDelay: '0.2s' }}>⭐</div>
                        <div className="absolute top-10 -right-6 text-3xl animate-bounce" style={{ animationDelay: '0.4s' }}>⭐</div>
                      </>
                    )}

                    {/* Status badge */}
                    <div
                      className={`absolute -bottom-4 left-1/2 transform -translate-x-1/2 px-6 py-2 rounded-full text-white font-bold text-lg whitespace-nowrap shadow-lg border-2 border-white ${
                        lastScanRecord.status === 'Terlambat' ? 'bg-red-500' : 'bg-green-500'
                      }`}
                    >
                      {lastScanRecord.status === 'Terlambat' ? 'Telat 🐢' : 'Tepat Waktu ⭐'}
                    </div>
                  </div>

                  <h2 className="text-4xl font-bold text-teal-900 mt-8 mb-2">{lastScanned.name}</h2>

                  <p
                    className={`text-3xl font-bold mb-4 ${
                      lastScanRecord.status === 'Terlambat' ? 'text-red-500' : 'text-green-500'
                    }`}
                  >
                    {lastScanRecord.time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </p>

                  {lastScanRecord.status === 'Tepat Waktu' ? (
                    <div className="bg-green-100 text-green-700 px-8 py-3 rounded-full font-bold text-2xl flex items-center gap-3 shadow-sm border-2 border-green-200">
                      <span className="text-3xl">⭐</span> Masya Allah, Tepat Waktu!
                    </div>
                  ) : (
                    <div className="bg-orange-100 text-orange-600 px-8 py-3 rounded-full font-bold text-2xl flex items-center gap-3 shadow-sm border-2 border-orange-200">
                      <span className="text-3xl">⏰</span> Ayo, Besok Lebih Cepat Ya!
                    </div>
                  )}

                  {/* Speaking indicator */}
                  {isSpeaking && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-4 flex items-center gap-2 text-teal-600 text-lg font-medium"
                    >
                      <span className="animate-pulse">🔊</span> Berbicara...
                    </motion.div>
                  )}
                </motion.div>

              ) : (
                /* ── Idle / waiting state ── */
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center"
                >
                  <div className="w-32 h-32 bg-teal-100 rounded-full flex items-center justify-center mb-4 border-4 border-dashed border-teal-300 animate-pulse">
                    <span className="text-5xl">📷</span>
                  </div>
                  <h2 className="text-3xl font-bold text-teal-800">Silakan Scan ID</h2>
                  <p className="text-teal-600 mt-2 text-lg font-medium">Menunggu tap kartu...</p>

                  {notification && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="mt-6 flex items-center gap-2 text-red-600 bg-red-100 px-6 py-3 rounded-full text-xl font-bold border-2 border-red-200"
                    >
                      {notification}
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Attendance History ── */}
        <section className="w-full mt-8 bg-white rounded-3xl shadow-lg border-4 border-teal-100 overflow-hidden">

          {/* History header */}
          <div className="bg-teal-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b-4 border-teal-200">
            <div className="flex items-center gap-3">
              <History className="w-8 h-8 text-teal-600" />
              <h3 className="text-2xl font-bold text-teal-800">
                Riwayat Kehadiran Sesi {activeSession}{' '}
                <br className="md:hidden" />
                <span className="text-lg font-medium text-teal-600 md:ml-2">
                  {currentTime.toLocaleDateString('id-ID', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </h3>
            </div>

            <div className="flex items-center gap-4">
              {/* Real-time clock */}
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border-2 border-teal-200 text-teal-800 font-bold text-xl">
                <Clock className="w-5 h-5 text-teal-500" />
                {currentTime.toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>

              {/* Download PDF */}
              <button
                onClick={() => requireAuth(downloadPDF)}
                className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 px-4 py-2 rounded-full font-bold shadow-sm border-2 border-yellow-500 transition-colors active:scale-95 cursor-pointer"
              >
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline">Download PDF</span>
              </button>
            </div>
          </div>

          {/* History list */}
          <div className="p-6">
            {attendances.filter((a) => a.session === activeSession).length === 0 ? (
              <div className="text-center py-12 bg-teal-50 rounded-2xl border-2 border-dashed border-teal-200">
                <p className="text-xl text-teal-600 font-medium">
                  Belum ada santri yang hadir di sesi ini 🏃‍♂️💨
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2">
                <AnimatePresence>
                  {attendances
                    .filter((a) => a.session === activeSession)
                    .map((record) => (
                      <motion.div
                        key={record.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-teal-50 rounded-2xl px-6 py-4 flex items-center justify-between border-2 border-teal-100 hover:border-teal-300 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-3xl">{record.gender === 'L' ? '👦' : '👧'}</span>
                          <span className="text-2xl font-bold text-teal-900">{record.studentName}</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <div
                            className={`px-4 py-1.5 rounded-full font-bold text-lg border-2 ${
                              record.status === 'Tepat Waktu'
                                ? 'bg-green-100 text-green-700 border-green-200'
                                : 'bg-red-100 text-red-600 border-red-200'
                            }`}
                          >
                            {record.time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          {record.status === 'Tepat Waktu' ? (
                            <CheckCircle className="text-green-500 w-8 h-8 hidden sm:block" />
                          ) : (
                            <XCircle className="text-red-500 w-8 h-8 hidden sm:block" />
                          )}
                        </div>
                      </motion.div>
                    ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </section>

      </main>

      {/* ── PIN Auth Modal ── */}
      <AnimatePresence>
        {authModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                <Shield className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-teal-900 mb-2">Tunggu!</h3>
              <p className="text-teal-700 mb-6 font-medium">Apakah kamu pengajar?</p>

              <div className="w-full">
                <input
                  type="password"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handlePinSubmit();
                    }
                  }}
                  className={`w-full text-center text-3xl tracking-[0.5em] font-bold py-3 rounded-xl border-4 outline-none transition-colors ${
                    pinError
                      ? 'border-red-400 bg-red-50'
                      : 'border-teal-200 focus:border-teal-500 bg-teal-50'
                  }`}
                  placeholder="****"
                  autoFocus
                />

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setAuthModal({ isOpen: false, action: null });
                    }}
                    className="flex-1 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      handlePinSubmit();
                    }}
                    className="flex-1 py-3 rounded-xl font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                  >
                    Masuk
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
