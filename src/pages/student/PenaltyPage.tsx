import { useAuth } from '@/hooks/useAuth';
import { usePenaltyProfileQuery, usePenaltyRecordsQuery, useWarningRecordsQuery } from '@/features/penalty/hooks';
import { computeRiskLevel } from '@/features/penalty/risk';
import { PENALTY_REASON_LABEL, type PenaltyReasonCode } from '@/constants/penaltyRules';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

export default function PenaltyPage() {
  const { user } = useAuth();
  const studentId = user!.id;

  const { data: profile, isLoading: isProfileLoading } = usePenaltyProfileQuery(studentId);
  const { data: penaltyRecords } = usePenaltyRecordsQuery(studentId);
  const { data: warningRecords } = useWarningRecordsQuery(studentId);

  if (isProfileLoading || !profile) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const risk = computeRiskLevel(profile.currentPenaltyPoints);

  return (
    <div className="flex flex-col gap-6 p-4">
      <h2 className="text-lg font-semibold text-gray-900">벌점 조회</h2>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-gray-500">현재 벌점</p>
          <p className="text-2xl font-bold text-gray-900">{profile.currentPenaltyPoints}점</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">경고 횟수</p>
          <p className="text-2xl font-bold text-gray-900">{profile.warningCount}회</p>
        </Card>
      </div>

      <Card className="flex items-center justify-between">
        <span className="text-sm text-gray-500">퇴원 위험도</span>
        <Badge tone={risk.tone}>{risk.label}</Badge>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">벌점 이력</h3>
        {!penaltyRecords || penaltyRecords.length === 0 ? (
          <EmptyState title="벌점 이력이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {penaltyRecords.map((record) => (
              <li
                key={record.id}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {PENALTY_REASON_LABEL[record.reason_code as PenaltyReasonCode] ?? record.reason_code}
                  </p>
                  <p className="text-xs text-gray-500">{new Date(record.created_at).toLocaleDateString('ko-KR')}</p>
                </div>
                <Badge tone={record.adjustment_type === 'add' ? 'danger' : 'success'}>
                  {record.adjustment_type === 'add' ? '+' : '-'}
                  {record.points}점
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">경고 이력</h3>
        {!warningRecords || warningRecords.length === 0 ? (
          <EmptyState title="경고 이력이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {warningRecords.map((record) => (
              <li
                key={record.id}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <span>{new Date(record.issued_at).toLocaleDateString('ko-KR')}</span>
                <Badge tone="danger">
                  {record.warning_level === 3 ? '퇴원' : `${record.warning_level}차 경고`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
