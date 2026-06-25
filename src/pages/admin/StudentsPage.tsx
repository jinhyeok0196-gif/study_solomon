import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudentsQuery } from '@/features/admin-students/hooks';
import { CreateStudentForm } from '@/features/admin-students/components/CreateStudentForm';
import { ADMIN_PATHS } from '@/routes/paths';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

export default function StudentsPage() {
  const { data: students, isLoading } = useStudentsQuery();
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim();
    if (!term) return students ?? [];
    return (students ?? []).filter(
      (student) => student.name.includes(term) || student.phone.includes(term)
    );
  }, [students, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">학생 관리</h2>
        <Button onClick={() => setShowCreateForm((prev) => !prev)}>
          {showCreateForm ? '닫기' : '신규 학생 등록'}
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <CreateStudentForm onCreated={() => setShowCreateForm(false)} />
        </Card>
      )}

      <Input
        placeholder="이름 또는 전화번호로 검색"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-xs"
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="등록된 학생이 없습니다" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">전화번호</th>
                <th className="px-3 py-2">학교/학년</th>
                <th className="px-3 py-2">벌점</th>
                <th className="px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((student) => (
                <tr key={student.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link to={ADMIN_PATHS.studentDetail(student.id)} className="font-medium text-brand-700 hover:underline">
                      {student.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{student.phone}</td>
                  <td className="px-3 py-2">
                    {student.school ?? '-'} {student.grade ?? ''}
                  </td>
                  <td className="px-3 py-2">{student.currentPenaltyPoints}점</td>
                  <td className="px-3 py-2">
                    <Badge tone={student.membershipStatus === 'active' ? 'success' : 'danger'}>
                      {student.membershipStatus === 'active'
                        ? '재원'
                        : student.membershipStatus === 'paused'
                          ? '휴원'
                          : '퇴원'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
