import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useCheckinTokenQuery } from '@/features/checkin/hooks';
import { ADMIN_PATHS } from '@/routes/paths';

export default function CheckinKioskPage() {
  const { data: token, isLoading, error } = useCheckinTokenQuery();
  const now = useCurrentTime(1000);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!token) return;
    const url = `${window.location.origin}/checkin?token=${encodeURIComponent(token)}`;
    let cancelled = false;
    QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };

  const clock = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateLabel = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-[3vmin] bg-gray-900 px-6 py-8 text-white">
      {/* 우상단 컨트롤 (스캔에 방해되지 않게 옅게) */}
      <div className="absolute right-4 top-4 flex gap-2 text-sm text-gray-400">
        <button
          onClick={toggleFullscreen}
          className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
        >
          {isFullscreen ? '전체화면 해제' : '전체화면'}
        </button>
        <Link to={ADMIN_PATHS.dashboard} className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20">
          나가기
        </Link>
      </div>

      <div className="text-center">
        <h1 className="text-[3.6vmin] font-bold">등·하원 체크인</h1>
        <p className="mt-1 text-[2vmin] text-gray-300">휴대폰 카메라로 QR을 스캔하세요</p>
        <p className="mt-2 text-[1.8vmin] text-gray-400">{dateLabel}</p>
        <p className="font-mono text-[5vmin] font-bold leading-none tabular-nums text-brand-400">{clock}</p>
      </div>

      {/* QR + 주의사항 (가로 배치) */}
      <div className="flex flex-col items-center gap-[4vmin] lg:flex-row">
        <div className="flex aspect-square w-[min(58vmin,520px)] flex-shrink-0 items-center justify-center rounded-3xl bg-white p-[3vmin] shadow-2xl">
          {isLoading && <Spinner />}
          {error && (
            <p className="text-center text-[2vmin] text-red-500">
              QR을 불러오지 못했습니다.
              <br />
              관리자 계정으로 로그인했는지 확인하세요.
            </p>
          )}
          {!isLoading && !error && qrDataUrl && (
            <img src={qrDataUrl} alt="등하원 체크인 QR" className="h-full w-full" />
          )}
        </div>

        {/* 주의사항 */}
        <div className="max-w-[46vmin] rounded-2xl border border-white/10 bg-white/5 p-[3vmin] text-left">
          <p className="mb-[1.8vmin] text-[2.4vmin] font-bold text-white">📌 이용 안내</p>
          <ul className="space-y-[1.6vmin] text-[1.9vmin] leading-relaxed text-gray-300">
            <li>
              1️⃣ <b className="text-white">첫 스캔 = 등원</b>, 다시 스캔하면{' '}
              <b className="text-white">하원</b> 처리됩니다.
            </li>
            <li>
              ⏰ 첫 교시 시작 후 등원하면 <b className="text-amber-300">지각·벌점</b>이 자동 부여됩니다.
            </li>
            <li>
              🚪 남은 교시가 있는데 하원하면 <b className="text-amber-300">무단조퇴·벌점</b> (승인된 조퇴는 제외).
            </li>
            <li>
              📱 반드시 <b className="text-white">본인 계정으로 로그인</b>된 상태에서 스캔하세요.
            </li>
            <li>🔁 등원 후 5분 이내 다시 찍으면 무시됩니다(중복 방지).</li>
            <li>🔒 QR은 보안을 위해 자동 갱신 — 현장에서만 체크인할 수 있습니다.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
