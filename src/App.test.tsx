import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  isSupabaseConfigured: false,
  supabase: {},
}));

import { App } from './App';

describe('App', () => {
  it('shows a configuration error screen when Supabase env vars are missing', () => {
    render(<App />);
    expect(screen.getByText('배포 설정 오류')).toBeInTheDocument();
  });
});
