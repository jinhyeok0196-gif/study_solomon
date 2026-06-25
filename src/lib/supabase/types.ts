// 2단계(Supabase DB 설계)에서 `supabase gen types typescript` 결과로 교체될 자리표시자입니다.
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
