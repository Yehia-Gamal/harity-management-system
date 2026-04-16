declare const Deno: any;
// @ts-ignore - Deno runtime supports URL imports; TS language service may not resolve it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

export type JsonRecord = Record<string, unknown>;

export const FULL_ACCESS_ROLES = ["super_admin", "hidden_super_admin"];
export const LEGACY_ROLE_ALIASES: Record<string, string> = {
  admin: "super_admin",
  supervisor: "manager",
  data_entry: "explorer",
  auditor: "manager",
  viewer: "explorer",
};

export const json = (body: JsonRecord, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });

export function getAllowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((x: string) => x.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request): { headers: Record<string, string>; allowed: boolean } {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = getAllowedOrigins();
  const allowed = !origin || allowedOrigins.includes(origin);
  const headers: Record<string, string> = {
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
  if (origin && allowed) headers["access-control-allow-origin"] = origin;
  return { headers, allowed };
}

export function bearerToken(req: Request): string {
  const raw = req.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function normalizeRoleKey(roleKey: unknown): string {
  const raw = String(roleKey || "").trim();
  return LEGACY_ROLE_ALIASES[raw] || raw || "custom";
}

export function hasAppPermission(permissions: unknown, permissionKey: string): boolean {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return false;
  const p = permissions as Record<string, unknown>;
  const role = normalizeRoleKey(p.__role);
  return p[permissionKey] === true || FULL_ACCESS_ROLES.includes(role);
}

export function hasUsersManagePermission(permissions: unknown): boolean {
  return hasAppPermission(permissions, "users_manage");
}

export function sanitizePermissions(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = { ...(raw as Record<string, unknown>) };
  if (normalizeRoleKey(out.__role) === "hidden_super_admin") out.__role = "super_admin";
  return out;
}

export async function requireUsersManage(req: Request, headers: Record<string, string>) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceRoleKey) {
    return { response: json({ error: "server_not_configured" }, 500, headers) };
  }

  const token = bearerToken(req);
  if (!token) return { response: json({ error: "unauthorized" }, 401, headers) };

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  const caller = authData?.user;
  if (authError || !caller?.id) return { response: json({ error: "unauthorized" }, 401, headers) };

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,username,permissions,is_active")
    .eq("id", caller.id)
    .maybeSingle();

  if (profileError || !profile || profile.is_active === false) {
    return { response: json({ error: "forbidden" }, 403, headers) };
  }
  if (!hasUsersManagePermission(profile.permissions)) {
    return { response: json({ error: "forbidden" }, 403, headers) };
  }

  return { supabaseAdmin, caller, profile };
}
