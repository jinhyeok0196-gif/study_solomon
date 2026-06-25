export function formatElapsed(fromIso: string, to: Date): string {
  const totalSeconds = Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatRemaining(toIso: string, from: Date): string {
  const totalSeconds = Math.max(0, Math.floor((new Date(toIso).getTime() - from.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
