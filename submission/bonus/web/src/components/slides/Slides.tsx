import { useState } from 'react';

const SLIDES = [
  {
    id: 1,
    title: 'CDC là gì?',
    content: 'Change Data Capture (CDC) là kỹ thuật theo dõi và capture các thay đổi trong database để đồng bộ sang hệ thống khác.',
    icon: '🔄',
    bg: 'bg-gradient-to-br from-blue-900 to-slate-900',
  },
  {
    id: 2,
    title: 'Tại sao CDC quan trọng?',
    content: '• Near real-time data sync\n• Không impact production DB\n• Audit trail đầy đủ\n• Event sourcing capability',
    icon: '💡',
    bg: 'bg-gradient-to-br from-amber-900 to-slate-900',
  },
  {
    id: 3,
    title: 'Debezium Architecture',
    content: 'Debezium kết nối vào MySQL binlog, PostgreSQL WAL để capture mọi thay đổi và publish qua Kafka.',
    icon: '🏗️',
    bg: 'bg-gradient-to-br from-emerald-900 to-slate-900',
  },
  {
    id: 4,
    title: 'Lakehouse Pattern',
    content: 'Bronze → Silver → Gold:\n• Bronze: Raw CDC data\n• Silver: Cleaned & validated\n• Gold: Business aggregations',
    icon: '🏛️',
    bg: 'bg-gradient-to-br from-purple-900 to-slate-900',
  },
  {
    id: 5,
    title: 'Demo Time!',
    content: 'Xem pipeline xử lý CDC events theo thời gian thực từ source → Bronze → Silver → Gold.',
    icon: '🎮',
    bg: 'bg-gradient-to-br from-rose-900 to-slate-900',
  },
];

export default function Slides() {
  const [currentSlide, setCurrentSlide] = useState(0);

  const nextSlide = () => {
    setCurrentSlide(prev => (prev + 1) % SLIDES.length);
  };

  const prevSlide = () => {
    setCurrentSlide(prev => (prev - 1 + SLIDES.length) % SLIDES.length);
  };

  const slide = SLIDES[currentSlide];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-emerald-400 mb-2">CDC Lakehouse Presentation</h1>
        <p className="text-slate-400">Slide {currentSlide + 1} / {SLIDES.length}</p>
      </div>

      <div className={`${slide.bg} rounded-2xl border border-slate-700 p-12 min-h-96 flex flex-col items-center justify-center relative overflow-hidden`}>
        <div className="absolute top-6 right-6 text-8xl opacity-20">{slide.icon}</div>

        <h2 className="text-4xl font-bold text-white mb-8 text-center z-10">
          {slide.title}
        </h2>

        <div className="text-xl text-slate-300 whitespace-pre-line text-center z-10 max-w-2xl">
          {slide.content}
        </div>

        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-3">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`w-3 h-3 rounded-full transition ${
                idx === currentSlide ? 'bg-emerald-400' : 'bg-slate-600 hover:bg-slate-500'
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center mt-8">
        <button
          onClick={prevSlide}
          className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-lg font-semibold transition flex items-center gap-2"
        >
          ← Previous
        </button>

        <div className="flex gap-2">
          {SLIDES.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setCurrentSlide(idx)}
              className={`w-10 h-10 rounded-lg font-semibold transition ${
                idx === currentSlide
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {s.id}
            </button>
          ))}
        </div>

        <button
          onClick={nextSlide}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-semibold transition flex items-center gap-2"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
