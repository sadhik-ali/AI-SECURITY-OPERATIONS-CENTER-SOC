import type { User } from '../types/api';

const TOKEN_KEY = 'ai-soc.token';
const USER_KEY = 'ai-soc.user';

/** Mirrors the Phase 2 backend seed so the same credentials work end to end. */
export const DEMO_CREDENTIALS = [
  { email: 'analyst@aisoc.dev', password: 'SocDemo!23', role: 'analyst' as const, full_name: 'Adnan Sardhi' },
  { email: 'admin@aisoc.dev', password: 'SocDemo!23', role: 'admin' as const, full_name: 'Dana Novak' },
];

export const DEMO_PASSWORD_HINT = 'SocDemo!23';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getToken() && getStoredUser());
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export function validateEmail(value: string): string | null {
  if (!value.trim()) return 'Email is required';
  if (!EMAIL_PATTERN.test(value.trim())) return 'Enter a valid email address';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  return null;
}
