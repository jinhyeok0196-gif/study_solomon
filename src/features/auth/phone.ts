const AUTH_EMAIL_DOMAIN = 'members.solomonstudycafe.internal';

export function normalizePhone(rawPhone: string): string {
  return rawPhone.replace(/\D/g, '');
}

export function isValidPhone(rawPhone: string): boolean {
  return /^01[0-9]\d{7,8}$/.test(normalizePhone(rawPhone));
}

// Supabase Auth는 이메일 기준이므로, 전화번호 로그인을 위해 내부 전용 가상 이메일로 매핑한다.
export function phoneToAuthEmail(rawPhone: string): string {
  return `p${normalizePhone(rawPhone)}@${AUTH_EMAIL_DOMAIN}`;
}
