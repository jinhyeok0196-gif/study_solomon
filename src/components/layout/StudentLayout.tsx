import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { StudentBottomNav } from './StudentBottomNav';

export function StudentLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header title="솔로몬스터디카페" />
      <main className="flex-1 pb-16">
        <Outlet />
      </main>
      <StudentBottomNav />
    </div>
  );
}
