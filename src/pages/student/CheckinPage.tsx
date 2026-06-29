import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { STUDENT_PATHS } from '@/routes/paths';
import { useCheckinByQr } from '@/features/checkin/hooks';
import type { CheckinResult } from '@/features/checkin/api';

function ResultView({ result }: { result: CheckinResult }) {
  const time = new Date(result.scanned_at).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (result.action === 'out') {
    if (result.early_leave) {
      return (
        <Banner
          emoji="🚪"
          tone="warning"
          title="조퇴 처리"
          lines={[
            `${time} 하원 처리되었습니다.`,
            `남은 교시가 있어 무단 조퇴로 벌점 ${result.points_added}점이 부여되었습니다.`,
          ]}
        />
      );
    }
    return (
      <Banner emoji="👋" tone="info" title="하원 완료" lines={[`${time} 하원 처리되었습니다.`, '오늘도 수고하셨습니다!']} />
    );
  }
  if (result.action === 'already_out') {
    return <Banner emoji="✅" tone="info" title="이미 하원했습니다" lines={['오늘 등·하원이 모두 완료되었습니다.']} />;
  }
  if (result.action === 'already_in') {
    return <Banner emoji="✅" tone="success" title="이미 등원했습니다" lines={[`${time} 기준 등원 상태입니다.`]} />;
  }
  // action === 'in'
  if (result.status === 'late') {
    return (
      <Banner
        emoji="⏰"
        tone="warning"
        title={`${result.minutes_late}분 지각`}
        lines={[`${time} 등원 처리되었습니다.`, `지각으로 벌점 ${result.points_added}점이 부여되었습니다.`]}
      />
    );
  }
  return (
    <Banner emoji="🎉" tone="success" title="정시 등원 완료" lines={[`${time} 등원 처리되었습니다.`, '오늘도 화이팅!']} />
  );
}

function Banner({
  emoji,
  title,
  lines,
  tone,
}: {
  emoji: string;
  title: string;
  lines: string[];
  tone: 'success' | 'warning' | 'info';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-brand-700'
      : tone === 'warning'
      ? 'text-amber-600'
      : 'text-gray-700';
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="text-5xl">{emoji}</span>
      <h2 className={`text-2xl font-bold ${toneClass}`}>{title}</h2>
      <div className="space-y-1 text-gray-600">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

export default function CheckinPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { mutate, data, error, isPending, isIdle } = useCheckinByQr();
  const triggered = useRef(false);

  useEffect(() => {
    if (!token || triggered.current) return;
    triggered.current = true;
    mutate(token);
  }, [token, mutate]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <Card>
        <h1 className="mb-2 text-center text-lg font-semibold text-gray-800">등·하원 체크인</h1>

        {!token && (
          <Banner
            emoji="❌"
            tone="warning"
            title="잘못된 접근입니다"
            lines={['입구 화면의 QR을 카메라로 스캔해주세요.']}
          />
        )}

        {token && (isPending || isIdle) && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Spinner />
            <p className="text-gray-500">체크인 처리 중…</p>
          </div>
        )}

        {error && (
          <Banner emoji="⚠️" tone="warning" title="체크인 실패" lines={[(error as Error).message]} />
        )}

        {data && <ResultView result={data} />}

        {(data || error) && (
          <div className="mt-4 flex flex-col gap-2">
            <Link
              to={STUDENT_PATHS.dashboard}
              className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              홈으로
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
