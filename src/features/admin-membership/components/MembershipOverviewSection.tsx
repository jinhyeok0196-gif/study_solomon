import { useMemo, useState } from 'react';
import { useMembershipOverviewQuery } from '../hooks';
import {
  computeKpis,
  computeMembership,
  rowBgClass,
  remainingLabel,
  STATE_BADGE,
  type MembershipState,
} from '../logic';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;

const STATUS_OPTIONS: { value: 'all' | MembershipState; label: string }[] = [
  { value: 'all', label: '전체 상태' },
  { value: 'active', label: '이용중' },
  { value: 'expiring', label: '7일 이내 만료' },
  { value: 'today', label: '오늘 만료' },
  { value: 'expired', label: '만료' },
  { value: 'paused', label: '일시정지' },
];

function StatusBadge({ state }: { state: MembershipState }) {
  const b = STATE_BADGE[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        b.className
      )}
    >
      <span>{b.dot}</span>
      {b.label}
    </span>
  );
}

export function MembershipOverviewSection() {
  const { data: rows, isLoading, isError } = useMembershipOverviewQuery();
  const today = useMemo(() => new Date(), []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MembershipState>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const computed = useMemo(
    () => (rows ?? []).map((r) => computeMembership(r, today)),
    [rows, today]
  );
  const kpis = useMemo(() => computeKpis(computed), [computed]);
  const types = useMemo(
    () => Array.from(new Set(computed.map((r) => r.membershipType).filter((t): t is string => !!t))),
    [computed]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return computed.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.phone.includes(q)) return false;
      if (statusFilter !== 'all' && r.state !== statusFilter) return false;
      if (typeFilter !== 'all' && r.membershipType !== typeFilter) return false;
      return true;
    });
  }, [computed, search, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const resetPage = () => setPage(0);

  const kpiCards = [
    { label: '전체 이용 학생', value: kpis.activeTotal, color: 'text-gray-900' },
    { label: '오늘 만료', value: kpis.todayExpire, color: 'text-orange-600' },
    { label: '7일 이내 만료', value: kpis.within7, color: 'text-yellow-600' },
    { label: '만료됨', value: kpis.expired, color: 'text-red-600' },
    { label: '자동연장 대상', value: kpis.autoRenew, color: 'text-blue-600' },
  ];

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700">이용권 현황</h3>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : isError ? (
        <Card>
          <p className="py-4 text-center text-sm text-red-500">이용권 정보를 불러오지 못했습니다.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {/* KPI 카드 5개 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {kpiCards.map((c) => (
              <Card key={c.label}>
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={cn('text-2xl font-bold', c.color)}>{c.value}명</p>
              </Card>
            ))}
          </div>

          {/* 필터 */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="이름·전화번호 검색"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:flex-1"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | MembershipState);
                resetPage();
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                resetPage();
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">전체 종류</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* 테이블 */}
          {filtered.length === 0 ? (
            <EmptyState title="해당하는 학생이 없습니다" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="px-3 py-2 font-medium">이름</th>
                    <th className="px-3 py-2 font-medium">전화번호</th>
                    <th className="px-3 py-2 font-medium">종류</th>
                    <th className="px-3 py-2 font-medium">시작일</th>
                    <th className="px-3 py-2 font-medium">만료일</th>
                    <th className="px-3 py-2 font-medium">남은기간</th>
                    <th className="px-3 py-2 font-medium">상태</th>
                    <th className="px-3 py-2 font-medium">자동연장</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id} className={cn('border-b border-gray-100 last:border-0', rowBgClass(r.state))}>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-gray-600">{r.phone || '-'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.membershipType ?? '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{r.startDate ?? '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{r.endDate ?? '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{remainingLabel(r.remainingDays)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge state={r.state} />
                      </td>
                      <td className="px-3 py-2">
                        {r.autoRenew ? (
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">ON</span>
                        ) : (
                          <span className="text-xs text-gray-400">OFF</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 페이지네이션 */}
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-gray-500">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
