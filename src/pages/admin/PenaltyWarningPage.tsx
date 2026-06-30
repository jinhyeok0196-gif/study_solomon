import { useState } from 'react';
import { PenaltySection } from './PenaltiesPage';
import { WarningSection } from './WarningsPage';

type Tab = 'penalty' | 'warning';

const TABS: { key: Tab; label: string }[] = [
  { key: 'penalty', label: '벌점' },
  { key: 'warning', label: '경고' },
];

export default function PenaltyWarningPage() {
  const [tab, setTab] = useState<Tab>('penalty');

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-gray-900">벌점·경고 관리</h2>

      {/* 탭 */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'penalty' ? <PenaltySection /> : <WarningSection />}
    </div>
  );
}
