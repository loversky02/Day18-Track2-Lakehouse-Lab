import { useState, useEffect, useCallback, useMemo } from 'react';

interface CDCEvent {
  id: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  timestamp: number;
  eventTimestamp: number; // Event time (not processing time) - critical for late data
  data: Record<string, string | number>;
  status: 'pending' | 'bronze' | 'silver' | 'gold';
  rawPII?: Record<string, string>; // Original PII before tokenization
  tokenizedPII?: Record<string, string>; // Tokenized PII
}

interface LogEntry {
  timestamp: number;
  stage: string;
  message: string;
  eventId: string;
  detail?: string;
}

interface AuditLog {
  id: string;
  who: string;
  whatTable: string;
  whatToken: string;
  when: number;
  rowsReturned: number;
}

interface SCDRecord {
  driver_id: string;
  name: string;
  phone_token: string;
  cmnd_token: string;
  effective_from: number;
  effective_to: number;
  is_current: boolean;
  version: number;
}

// ============================================================
// TOKENIZATION UDF - Vietnamese PII (Decree 13 compliant)
// ============================================================
function hashPII(value: string): string {
  let hash = 0;
  const str = value.trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(12, '0').slice(0, 12);
}

function tokPhone(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/^(\+84|84)/, '0').replace(/[\s\-]/g, '');
  if (/^0[0-9]{9,10}$/.test(cleaned)) {
    return `PHONE_${hashPII(cleaned).slice(0, 12)}`;
  }
  return null;
}

function tokCMND(cmnd: string): string | null {
  if (!cmnd) return null;
  const cleaned = cmnd.replace(/[\s\-]/g, '');
  if (/^[0-9]{9}$|^[0-9]{12}$/.test(cleaned)) {
    return `CMND_${hashPII(cleaned).slice(0, 12)}`;
  }
  return null;
}

// ============================================================
// SAMPLE DATA - Ride-hailing context
// ============================================================
const SAMPLE_DRIVERS = [
  { id: 'D001', name: 'Nguyễn Văn A', phone: '+84909123456', cmnd: '123456789' },
  { id: 'D002', name: 'Trần Thị B', phone: '0987654321', cmnd: '987654321' },
  { id: 'D003', name: 'Lê Văn C', phone: '+84391234567', cmnd: '123456789012' },
];

const SAMPLE_TRIPS = [
  { id: 'T001', driver_id: 'D001', amount: 85000, status: 'completed' },
  { id: 'T002', driver_id: 'D002', amount: 120000, status: 'in_progress' },
  { id: 'T003', driver_id: 'D001', amount: 65000, status: 'completed' },
];

// ============================================================
// DELTA CDF CHANGE TYPES
// ============================================================
type ChangeType = 'insert' | 'update_before' | 'update_after' | 'delete';

interface CDFChange {
  table: string;
  changeType: ChangeType;
  data: Record<string, string | number>;
  timestamp: number;
}

// ============================================================
// LATE DATA SCENARIO GENERATOR
// ============================================================
function generateLateDataEvent(): CDCEvent {
  const isLate = Math.random() < 0.3; // 30% chance of late arrival
  const eventTime = Date.now() - (isLate ? randomDelay(30000, 180000) : 0); // 30s-3min late

  return {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    table: 'trips',
    operation: 'INSERT',
    timestamp: Date.now(),
    eventTimestamp: eventTime,
    data: {
      ...SAMPLE_TRIPS[Math.floor(Math.random() * SAMPLE_TRIPS.length)],
      event_time: new Date(eventTime).toLocaleTimeString(),
    },
    status: 'pending',
  };
}

function randomDelay(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// COMPONENTS
// ============================================================

function TokenizationPanel({ events }: { events: CDCEvent[] }) {
  const tokenizedEvents = events.filter(e => e.tokenizedPII && Object.keys(e.tokenizedPII).length > 0).slice(-5);

  return (
    <div className="bg-purple-900/20 border border-purple-700 rounded-lg p-4">
      <h3 className="text-purple-400 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-purple-400 rounded-full"></span>
        Tokenization (Decree 13)
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {tokenizedEvents.length === 0 ? (
          <p className="text-slate-500 text-sm">Tokenization đang chờ...</p>
        ) : (
          tokenizedEvents.map(e => (
            <div key={e.id} className="bg-slate-800/50 rounded p-2 text-sm">
              <div className="text-slate-400 mb-1">Trip: {e.data.id}</div>
              {e.rawPII && Object.entries(e.rawPII).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="text-red-400">{key}: {value}</span>
                  <span className="text-slate-500">→</span>
                  <span className="text-emerald-400">{e.tokenizedPII?.[key]}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LateDataPanel({ events }: { events: CDCEvent[] }) {
  const pendingEvents = events.filter(e => e.status === 'pending' || e.status === 'bronze');

  const isLate = (event: CDCEvent) => {
    const delay = Date.now() - event.eventTimestamp;
    return delay > 10000; // >10s delay = late
  };

  return (
    <div className="bg-rose-900/20 border border-rose-700 rounded-lg p-4">
      <h3 className="text-rose-400 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-rose-400 rounded-full animate-pulse"></span>
        Late Data Handling
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {pendingEvents.length === 0 ? (
          <p className="text-slate-500 text-sm">Không có sự kiện đến muộn...</p>
        ) : (
          pendingEvents.map(e => (
            <div key={e.id} className="bg-slate-800/50 rounded p-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-300">Trip: {e.data.id}</span>
                {isLate(e) && (
                  <span className="px-2 py-0.5 bg-rose-900 text-rose-300 text-xs rounded animate-pulse">
                    ⚠️ LATE ({Math.round((Date.now() - e.eventTimestamp) / 1000)}s)
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Event time: {new Date(e.eventTimestamp).toLocaleTimeString()}
              </div>
              {!isLate(e) && (
                <div className="text-xs text-emerald-500 mt-1">
                  ✓ MERGE src.ts ({new Date(e.eventTimestamp).toLocaleTimeString()}) {'>'} tgt.ts → APPLY
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CDFPanel({ changes }: { changes: CDFChange[] }) {
  const recentChanges = changes.slice(-10);

  const getChangeColor = (type: ChangeType) => {
    switch (type) {
      case 'insert': return 'bg-emerald-900 text-emerald-300';
      case 'update_before': return 'bg-amber-900 text-amber-300';
      case 'update_after': return 'bg-blue-900 text-blue-300';
      case 'delete': return 'bg-red-900 text-red-300';
    }
  };

  return (
    <div className="bg-cyan-900/20 border border-cyan-700 rounded-lg p-4">
      <h3 className="text-cyan-400 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></span>
        Delta CDF (Change Data Feed)
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {recentChanges.length === 0 ? (
          <p className="text-slate-500 text-sm">Đang theo dõi CDF...</p>
        ) : (
          recentChanges.map((c, idx) => (
            <div key={idx} className="bg-slate-800/50 rounded p-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-300">{c.table}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getChangeColor(c.changeType)}`}>
                  {c.changeType}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {Object.keys(c.data).slice(0, 3).join(', ')}...
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SCDPanel({ records }: { records: SCDRecord[] }) {
  const currentRecords = records.filter(r => r.is_current);

  return (
    <div className="bg-violet-900/20 border border-violet-700 rounded-lg p-4">
      <h3 className="text-violet-400 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-violet-400 rounded-full"></span>
        SCD Type 2 (Driver Dimension)
      </h3>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {currentRecords.length === 0 ? (
          <p className="text-slate-500 text-sm">Chờ driver dimension...</p>
        ) : (
          currentRecords.map(r => (
            <div key={r.driver_id} className="bg-slate-800/50 rounded p-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-300 font-medium">{r.name}</span>
                <span className="text-xs text-slate-500">v{r.version}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 mt-2 text-xs">
                <div className="text-slate-500">ID: <span className="text-slate-300">{r.driver_id}</span></div>
                <div className="text-slate-500">Phone: <span className="text-emerald-400">{r.phone_token}</span></div>
                <div className="text-slate-500">CMND: <span className="text-emerald-400">{r.cmnd_token}</span></div>
                <div className="text-slate-500">Valid: <span className="text-amber-400">
                  {new Date(r.effective_from).toLocaleDateString()} - {r.effective_to === 9999999999999 ? '9999' : new Date(r.effective_to).toLocaleDateString()}
                </span></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BronzeLayer({ events }: { events: CDCEvent[] }) {
  const bronzeEvents = events.filter(e => e.status === 'bronze');
  return (
    <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-4">
      <h3 className="text-amber-400 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-amber-400 rounded-full animate-pulse"></span>
        Bronze Layer (Raw CDC)
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {bronzeEvents.length === 0 ? (
          <p className="text-slate-500 text-sm">Chờ CDC events...</p>
        ) : (
          bronzeEvents.map(e => (
            <div key={e.id} className="bg-slate-800/50 rounded p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  e.operation === 'INSERT' ? 'bg-green-900 text-green-300' :
                  e.operation === 'UPDATE' ? 'bg-blue-900 text-blue-300' :
                  'bg-red-900 text-red-300'
                }`}>{e.operation}</span>
                <span className="text-slate-300">{e.table}</span>
              </div>
              {e.rawPII && (
                <div className="mt-1 text-xs text-red-400/70">
                  PII: {Object.values(e.rawPII).join(', ')}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SilverLayer({ events }: { events: CDCEvent[] }) {
  const silverEvents = events.filter(e => e.status === 'silver');
  return (
    <div className="bg-slate-700/30 border border-slate-500 rounded-lg p-4">
      <h3 className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-slate-400 rounded-full"></span>
        Silver Layer (Tokenized)
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {silverEvents.length === 0 ? (
          <p className="text-slate-500 text-sm">Chờ tokenized data...</p>
        ) : (
          silverEvents.map(e => (
            <div key={e.id} className="bg-slate-800/50 rounded p-2 text-sm">
              <span className="text-emerald-400">{e.table}</span>
              <span className="text-slate-400 ml-2">→ {Object.keys(e.data).length} fields</span>
              {e.tokenizedPII && (
                <div className="mt-1 text-xs text-emerald-400/70">
                  Tokenized: {Object.values(e.tokenizedPII).join(', ')}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function GoldLayer({ events }: { events: CDCEvent[] }) {
  const goldEvents = events.filter(e => e.status === 'gold');
  return (
    <div className="bg-emerald-900/20 border border-emerald-600 rounded-lg p-4">
      <h3 className="text-emerald-400 font-semibold mb-3 flex items-center gap-2">
        <span className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></span>
        Gold Layer (Aggregated)
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {goldEvents.length === 0 ? (
          <p className="text-slate-500 text-sm">Chờ aggregated data...</p>
        ) : (
          goldEvents.map(e => (
            <div key={e.id} className="bg-slate-800/50 rounded p-2 text-sm">
              <span className="text-yellow-400">{e.table}</span>
              <span className="text-slate-400 ml-2">→ Analytics ready</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PipelineFlow() {
  return (
    <div className="flex items-center justify-center gap-4 my-6 text-slate-500">
      <div className="flex flex-col items-center">
        <div className="w-16 h-16 bg-amber-900/30 border-2 border-amber-600 rounded-lg flex items-center justify-center">
          <span className="text-2xl">🟠</span>
        </div>
        <span className="text-xs mt-1">Bronze</span>
        <span className="text-xs text-slate-500">Raw CDC</span>
      </div>
      <div className="text-2xl">→</div>
      <div className="flex flex-col items-center">
        <div className="w-16 h-16 bg-slate-700/30 border-2 border-slate-500 rounded-lg flex items-center justify-center">
          <span className="text-2xl">⬜</span>
        </div>
        <span className="text-xs mt-1">Silver</span>
        <span className="text-xs text-slate-500">Tokenized</span>
      </div>
      <div className="text-2xl">→</div>
      <div className="flex flex-col items-center">
        <div className="w-16 h-16 bg-emerald-900/30 border-2 border-emerald-500 rounded-lg flex items-center justify-center">
          <span className="text-2xl">🟡</span>
        </div>
        <span className="text-xs mt-1">Gold</span>
        <span className="text-xs text-slate-500">Analytics</span>
      </div>
    </div>
  );
}

function AuditPanel({ auditLogs }: { auditLogs: AuditLog[] }) {
  const recentLogs = auditLogs.slice(-5);
  return (
    <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-3">
      <h4 className="text-sm font-semibold text-slate-400 mb-2">📋 PII Access Audit Log</h4>
      {recentLogs.length === 0 ? (
        <p className="text-xs text-slate-500">Chưa có access logs...</p>
      ) : (
        <div className="space-y-1">
          {recentLogs.map(log => (
            <div key={log.id} className="text-xs">
              <span className="text-slate-500">{new Date(log.when).toLocaleTimeString()}</span>
              <span className="text-slate-400 ml-2">{log.who}</span>
              <span className="text-slate-500 ml-2">→ {log.whatToken}</span>
              <span className="text-emerald-600 ml-2">({log.rowsReturned} rows)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function LiveDemo() {
  const [events, setEvents] = useState<CDCEvent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ total: 0, processed: 0, rate: 0 });
  const [cdfChanges, setCdfChanges] = useState<CDFChange[]>([]);
  const [scdRecords, setScdRecords] = useState<SCDRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const addLog = useCallback((stage: string, message: string, eventId: string, detail?: string) => {
    setLogs(prev => [{
      timestamp: Date.now(),
      stage,
      message,
      eventId,
      detail,
    }, ...prev.slice(0, 49)]);
  }, []);

  const processEvents = useCallback(() => {
    setEvents(prev => {
      const updated = [...prev];

      updated.forEach(e => {
        // Bronze: capture raw CDC with PII
        if (e.status === 'pending') {
          const driver = SAMPLE_DRIVERS[Math.floor(Math.random() * SAMPLE_DRIVERS.length)];
          const rawPII = { phone: driver.phone, cmnd: driver.cmnd };

          setEvents(current => current.map(ev =>
            ev.id === e.id ? { ...ev, rawPII } : ev
          ));

          e.status = 'bronze';
          e.rawPII = rawPII;
          addLog('Bronze', `CDC ${e.operation} on ${e.table}`, e.id, `PII raw: ${driver.phone}, ${driver.cmnd}`);
          return;
        }

        // Silver: tokenize PII (Decree 13 compliance)
        if (e.status === 'bronze' && e.rawPII) {
          const tokenizedPII = {
            phone: tokPhone(e.rawPII.phone) || 'INVALID',
            cmnd: tokCMND(e.rawPII.cmnd) || 'INVALID',
          };

          setEvents(current => current.map(ev =>
            ev.id === e.id ? { ...ev, tokenizedPII } : ev
          ));

          e.status = 'silver';
          e.tokenizedPII = tokenizedPII;
          addLog('Silver', `Tokenized ${e.table} (Decree 13)`, e.id, `phone→${tokenizedPII.phone}, cmnd→${tokenizedPII.cmnd}`);

          // Add CDF change
          setCdfChanges(c => [...c, {
            table: e.table,
            changeType: 'insert',
            data: e.data,
            timestamp: Date.now(),
          }]);
          return;
        }

        // Gold: aggregate
        if (e.status === 'silver') {
          e.status = 'gold';
          addLog('Gold', `Aggregated ${e.table} for analytics`, e.id);

          // Add CDF change for gold
          setCdfChanges(c => [...c, {
            table: `${e.table}_gold`,
            changeType: 'insert',
            data: { ...e.data, aggregated_at: Date.now() },
            timestamp: Date.now(),
          }]);

          // Add audit log entry
          setAuditLogs(a => [...a, {
            id: `audit_${Date.now()}`,
            who: 'analyst@databricks',
            whatTable: e.table,
            whatToken: e.tokenizedPII?.phone || 'N/A',
            when: Date.now(),
            rowsReturned: Math.floor(Math.random() * 100) + 1,
          }]);
          return;
        }
      });

      return updated;
    });
  }, [addLog]);

  useEffect(() => {
    if (!isRunning) return;

    const startTime = Date.now();

    const eventInterval = setInterval(() => {
      const newEvent = generateLateDataEvent();
      setEvents(prev => [...prev.slice(-25), newEvent]);
      setStats(prev => ({ ...prev, total: prev.total + 1 }));
    }, randomDelay(1500, 3000));

    const processInterval = setInterval(() => {
      processEvents();
      setStats(prev => ({
        ...prev,
        processed: prev.processed + 1,
        rate: prev.processed > 0 ? Math.round((prev.processed / ((Date.now() - startTime) / 1000)) * 10) / 10 : 0
      }));
    }, 600);

    return () => {
      clearInterval(eventInterval);
      clearInterval(processInterval);
    };
  }, [isRunning, processEvents]);

  // Initialize SCD records
  useEffect(() => {
    const initialSCD: SCDRecord[] = SAMPLE_DRIVERS.map((d, idx) => ({
      driver_id: d.id,
      name: d.name,
      phone_token: tokPhone(d.phone) || '',
      cmnd_token: tokCMND(d.cmnd) || '',
      effective_from: Date.now() - 86400000 * (30 - idx * 10),
      effective_to: 9999999999999,
      is_current: true,
      version: 1,
    }));
    setScdRecords(initialSCD);
  }, []);

  const toggleSimulation = () => setIsRunning(prev => !prev);

  const resetSimulation = () => {
    setEvents([]);
    setLogs([]);
    setCdfChanges([]);
    setStats({ total: 0, processed: 0, rate: 0 });
    setIsRunning(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-emerald-400 mb-2">CDC Lakehouse Demo</h1>
        <p className="text-slate-400">
          Debezium CDC → Tokenization (Decree 13) → Late Data Handling → Delta CDF → SCD Type 2
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800/50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-amber-400">{stats.total}</div>
          <div className="text-sm text-slate-400">CDC Events</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-emerald-400">{stats.processed}</div>
          <div className="text-sm text-slate-400">Processed</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-400">{events.filter(e => e.status === 'pending').length}</div>
          <div className="text-sm text-slate-400">Pending</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-purple-400">{stats.rate}/s</div>
          <div className="text-sm text-slate-400">Throughput</div>
        </div>
      </div>

      <PipelineFlow />

      {/* Main layers */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <BronzeLayer events={events} />
        <SilverLayer events={events} />
        <GoldLayer events={events} />
      </div>

      {/* Advanced concepts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <TokenizationPanel events={events} />
        <LateDataPanel events={events} />
        <CDFPanel changes={cdfChanges} />
        <SCDPanel records={scdRecords} />
      </div>

      {/* Controls */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={toggleSimulation}
          className={`flex-1 py-3 px-6 rounded-lg font-semibold transition ${
            isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {isRunning ? '⏸ Dừng Simulation' : '▶️ Bắt đầu Simulation'}
        </button>
        <button
          onClick={resetSimulation}
          className="py-3 px-6 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition"
        >
          🔄 Reset
        </button>
      </div>

      {/* Audit Log */}
      <div className="mb-8">
        <AuditPanel auditLogs={auditLogs} />
      </div>

      {/* Processing Logs */}
      <div className="bg-slate-900/80 rounded-lg border border-slate-700">
        <h3 className="text-lg font-semibold text-slate-300 p-4 border-b border-slate-700">
          📋 Processing Logs
        </h3>
        <div className="h-64 overflow-y-auto p-4 font-mono text-sm">
          {logs.length === 0 ? (
            <p className="text-slate-500">Bắt đầu simulation để xem logs...</p>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="flex flex-col gap-0.5 py-1 border-b border-slate-800">
                <div className="flex gap-4">
                  <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className={`font-medium ${
                    log.stage === 'Bronze' ? 'text-amber-400' :
                    log.stage === 'Silver' ? 'text-slate-300' : 'text-emerald-400'
                  }`}>[{log.stage}]</span>
                  <span className="text-slate-300">{log.message}</span>
                </div>
                {log.detail && (
                  <div className="ml-24 text-xs text-slate-500">{log.detail}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
