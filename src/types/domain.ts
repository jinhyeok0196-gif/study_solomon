export type UserRole = 'student' | 'admin';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  name: string;
  phone: string;
}
