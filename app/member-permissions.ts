export type MemberRole = "admin" | "member" | "viewer";

export type MemberPermissions = {
  manageItems: boolean;
  registerPurchases: boolean;
  openItems: boolean;
  consumeItems: boolean;
  adjustStock: boolean;
  viewPlanning: boolean;
  viewHistory: boolean;
  manageSchedule: boolean;
};

const allPermissions: MemberPermissions = {
  manageItems: true,
  registerPurchases: true,
  openItems: true,
  consumeItems: true,
  adjustStock: true,
  viewPlanning: true,
  viewHistory: true,
  manageSchedule: true,
};

const memberPermissions: MemberPermissions = {
  manageItems: false,
  registerPurchases: true,
  openItems: true,
  consumeItems: true,
  adjustStock: false,
  viewPlanning: true,
  viewHistory: true,
  manageSchedule: false,
};

const viewerPermissions: MemberPermissions = {
  manageItems: false,
  registerPurchases: false,
  openItems: false,
  consumeItems: false,
  adjustStock: false,
  viewPlanning: true,
  viewHistory: true,
  manageSchedule: false,
};

/** Administradores têm acesso total; os demais partem do perfil e aplicam o que foi salvo. */
export function resolvePermissions(role: MemberRole, value: unknown): MemberPermissions {
  if (role === "admin") return allPermissions;
  const fallback = role === "viewer" ? viewerPermissions : memberPermissions;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    parsed = {};
  }
  return Object.fromEntries(Object.entries(fallback).map(([key, defaultValue]) => [key, typeof parsed[key] === "boolean" ? parsed[key] : defaultValue])) as MemberPermissions;
}

export function hasPermission(member: { role: MemberRole; permissions?: string }, permission: keyof MemberPermissions) {
  return resolvePermissions(member.role, member.permissions)[permission];
}
