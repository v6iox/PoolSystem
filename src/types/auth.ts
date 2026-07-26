export type Role = "owner" | "family" | "guest";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export const ROLE_RANK: Record<Role, number> = { guest: 0, family: 1, owner: 2 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
