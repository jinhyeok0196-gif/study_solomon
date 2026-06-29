/**
 * 받침 유무에 따라 '로/으로' 조사를 붙인다. (예: 화장실 → 화장실로, 병원 → 병원으로)
 * 한글이 아닌 경우엔 '로'로 폴백한다. ㄹ 받침은 '로'를 쓴다.
 */
export function withRo(word: string): string {
  if (!word) return word;
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return `${word}로`;
  const jongseong = (code - 0xac00) % 28;
  // 0 = 받침 없음, 8 = ㄹ 받침 → '로', 그 외 → '으로'
  return word + (jongseong === 0 || jongseong === 8 ? '로' : '으로');
}
