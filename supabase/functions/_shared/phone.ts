// 프런트엔드 src/features/auth/phone.ts 와 동일한 규칙. Edge Function은 별도 런타임이라 의도적으로 중복한다.
const AUTH_EMAIL_DOMAIN = 'members.solomonstudycafe.internal';

export function normalizePhone(rawPhone: string): string {
  return rawPhone.replace(/\D/g, '');
}

export function phoneToAuthEmail(rawPhone: string): string {
  return `p${normalizePhone(rawPhone)}@${AUTH_EMAIL_DOMAIN}`;
}
