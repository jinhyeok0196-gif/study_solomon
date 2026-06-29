import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Spinner } from '@/components/ui/Spinner';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useCheckinTokenQuery } from '@/features/checkin/hooks';
import { ADMIN_PATHS } from '@/routes/paths';

export default function CheckinQrPage() {
  const { data: token, isLoading, error } = useCheckinTokenQuery();
  const now = useCurrentTime(1000);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const url = `${window.location.origin}/checkin?token=${encodeURIComponent(token)}`;
    let cancelled = false;
    QRCode.toDataURL(url, { width: 420, margin: 1, errorCorrectionLevel: 'M' })
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

  const clock = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateLabel = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800">등·하원 체크인</h1>
        <p className="mt-1 text-gray-500">아래 QR을 휴대폰 카메라로 스캔하세요</p>
        <Link
          to={ADMIN_PATHS.checkinKiosk}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          🖥️ 전체화면 키오스크 열기
        </Link>
      </div>

      <div className="text-center">
        <p className="text-sm text-gray-500">{dateLabel}</p>
        <p className="font-mono text-4xl font-bold tabular-nums text-brand-700">{clock}</p>
      </div>

      <div className="flex h-[420px] w-[420px] items-center justify-center rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        {isLoading && <Spinner />}
        {error && <p className="text-center text-red-500">QR을 불러오지 못했습니다.<br />관리자 권한을 확인하세요.</p>}
        {!isLoading && !error && qrDataUrl && (
          <img src={qrDataUrl} alt="등하원 체크인 QR" className="h-full w-full" />
        )}
      </div>

      <div className="max-w-md space-y-1 text-center text-sm text-gray-500">
        <p>· QR은 보안을 위해 자동으로 갱신됩니다. (현장에서만 체크인 가능)</p>
        <p>· 학생은 본인 계정으로 로그인된 상태여야 합니다.</p>
        <p>· 첫 스캔은 <b>등원</b>, 다시 스캔하면 <b>하원</b>으로 처리됩니다.</p>
      </div>
    </div>
  );
}
