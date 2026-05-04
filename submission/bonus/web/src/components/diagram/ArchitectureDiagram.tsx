import { useState } from 'react';

interface Node {
  id: string;
  label: string;
  type: 'source' | 'bronze' | 'silver' | 'gold' | 'analytics';
  description: string;
  details: string[];
}

const NODES: Node[] = [
  {
    id: 'debezium',
    label: 'Debezium',
    type: 'source',
    description: 'CDC Connector',
    details: ['MySQL Binlog', 'PostgreSQL WAL', 'Real-time streaming'],
  },
  {
    id: 'kafka',
    label: 'Kafka',
    type: 'source',
    description: 'Message Broker',
    details: ['Topic: orders, customers', 'Partitioned by key', 'Retention 7 days'],
  },
  {
    id: 'bronze',
    label: 'Bronze',
    type: 'bronze',
    description: 'Raw CDC Data',
    details: ['Parquet format', 'Schema preserved', 'Full CDC history'],
  },
  {
    id: 'silver',
    label: 'Silver',
    type: 'silver',
    description: 'Cleaned & Validated',
    details: ['Deduplication', 'Type casting', 'NULL handling'],
  },
  {
    id: 'gold',
    label: 'Gold',
    type: 'gold',
    description: 'Business Models',
    details: ['Aggregations', 'Window functions', 'ML ready'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    type: 'analytics',
    description: 'Dashboards & BI',
    details: ['Grafana', 'Superset', 'Real-time KPIs'],
  },
];

const EDGES = [
  { from: 'debezium', to: 'kafka', label: 'CDC Events' },
  { from: 'kafka', to: 'bronze', label: 'Stream' },
  { from: 'bronze', to: 'silver', label: 'ETL' },
  { from: 'silver', to: 'gold', label: 'Transform' },
  { from: 'gold', to: 'analytics', label: 'Query' },
];

function getNodeColor(type: string) {
  switch (type) {
    case 'source': return 'bg-blue-600/20 border-blue-500';
    case 'bronze': return 'bg-amber-600/20 border-amber-500';
    case 'silver': return 'bg-slate-500/20 border-slate-400';
    case 'gold': return 'bg-emerald-600/20 border-emerald-500';
    case 'analytics': return 'bg-purple-600/20 border-purple-500';
    default: return 'bg-slate-600/20 border-slate-500';
  }
}

function getNodeTextColor(type: string) {
  switch (type) {
    case 'source': return 'text-blue-400';
    case 'bronze': return 'text-amber-400';
    case 'silver': return 'text-slate-300';
    case 'gold': return 'text-emerald-400';
    case 'analytics': return 'text-purple-400';
    default: return 'text-slate-300';
  }
}

export default function ArchitectureDiagram() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const handleNodeClick = (node: Node) => {
    setSelectedNode(prev => prev?.id === node.id ? null : node);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-slate-900/50 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-semibold text-slate-300 mb-6">Pipeline Architecture</h2>

        <div className="relative">
          <svg className="w-full h-96" viewBox="0 0 800 320">
            {EDGES.map((edge, idx) => {
              const fromIdx = NODES.findIndex(n => n.id === edge.from);
              const toIdx = NODES.findIndex(n => n.id === edge.to);
              const x1 = 100 + fromIdx * 140;
              const x2 = 100 + toIdx * 140;
              return (
                <g key={idx}>
                  <line
                    x1={x1}
                    y1={160}
                    x2={x2 - 50}
                    y2={160}
                    stroke="#475569"
                    strokeWidth={2}
                    strokeDasharray="5,5"
                  />
                  <text
                    x={(x1 + x2) / 2 - 30}
                    y={145}
                    fill="#94a3b8"
                    fontSize="12"
                  >
                    {edge.label}
                  </text>
                  <polygon
                    points={`${x2 - 55},155 ${x2 - 50},160 ${x2 - 55},165`}
                    fill="#475569"
                  />
                </g>
              );
            })}

            {NODES.map((node) => {
              const idx = NODES.findIndex(n => n.id === node.id);
              const x = 50 + idx * 140;
              const isSelected = selectedNode?.id === node.id;
              return (
                <g
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  style={{ cursor: 'pointer' }}
                  className="transition-all duration-200"
                >
                  <rect
                    x={x}
                    y={120}
                    width={100}
                    height={80}
                    rx={8}
                    fill={getNodeColor(node.type)}
                    stroke={isSelected ? '#10b981' : 'transparent'}
                    strokeWidth={isSelected ? 3 : 0}
                    className="hover:opacity-80"
                  />
                  <text
                    x={x + 50}
                    y={155}
                    textAnchor="middle"
                    fill={getNodeTextColor(node.type)}
                    fontSize="14"
                    fontWeight="bold"
                  >
                    {node.label}
                  </text>
                  <text
                    x={x + 50}
                    y={175}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="10"
                  >
                    {node.description}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-semibold text-slate-300 mb-4">
          {selectedNode ? `${selectedNode.label} Details` : 'Select a Component'}
        </h2>

        {selectedNode ? (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <h3 className={`text-lg font-semibold ${getNodeTextColor(selectedNode.type)}`}>
                {selectedNode.label}
              </h3>
              <p className="text-slate-400 text-sm mt-1">{selectedNode.description}</p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-400 mb-2">Features:</h4>
              <ul className="space-y-2">
                {selectedNode.details.map((detail, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-slate-300 text-sm">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <div className="text-4xl mb-4">🏗️</div>
            <p className="text-center">Click vào một component để xem chi tiết</p>
          </div>
        )}
      </div>

      <div className="lg:col-span-3 grid grid-cols-5 gap-4">
        <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
            <span className="text-blue-400 font-semibold">Source</span>
          </div>
          <p className="text-slate-400 text-sm">Kafka, Debezium, MySQL Binlog</p>
        </div>
        <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
            <span className="text-amber-400 font-semibold">Bronze</span>
          </div>
          <p className="text-slate-400 text-sm">Raw data, Parquet, CDC history</p>
        </div>
        <div className="bg-slate-700/30 border border-slate-500 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 bg-slate-400 rounded-full"></span>
            <span className="text-slate-300 font-semibold">Silver</span>
          </div>
          <p className="text-slate-400 text-sm">Cleaned, validated, deduplicated</p>
        </div>
        <div className="bg-emerald-900/20 border border-emerald-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 bg-emerald-500 rounded-full"></span>
            <span className="text-emerald-400 font-semibold">Gold</span>
          </div>
          <p className="text-slate-400 text-sm">Business models, aggregations</p>
        </div>
        <div className="bg-purple-900/20 border border-purple-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
            <span className="text-purple-400 font-semibold">Analytics</span>
          </div>
          <p className="text-slate-400 text-sm">Dashboards, Grafana, KPIs</p>
        </div>
      </div>
    </div>
  );
}
