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
        <h1 className="text-[4vmin] font-bold">등·하원 체크인</h1>
        <p className="mt-1 text-[2.2vmin] text-gray-300">휴대폰 카메라로 QR을 스캔하세요</p>
      </div>

      <div className="text-center">
        <p className="text-[2vmin] text-gray-400">{dateLabel}</p>
        <p className="font-mono text-[6vmin] font-bold leading-none tabular-nums text-brand-400">{clock}</p>
      </div>

      <div className="flex aspect-square w-[min(70vmin,640px)] items-center justify-center rounded-3xl bg-white p-[3vmin] shadow-2xl">
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

      <p className="text-[1.8vmin] text-gray-400">
        첫 스캔은 <b className="text-gray-200">등원</b>, 다시 스캔하면 <b className="text-gray-200">하원</b> · QR은 자동 갱신됩니다
      </p>
    </div>
  );
}
