declare const Deno: any;
import { corsHeaders, json, requireUsersManage, sanitizePermissions } from "../_shared/security.ts";

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const { headers, allowed } = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(allowed ? "ok" : "forbidden", { status: allowed ? 200 : 403, headers });
  }
  if (!allowed) return json({ error: "origin_not_allowed" }, 403, headers);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);

  let createdUserId = "";
  try {
    const guard = await requireUsersManage(req, headers);
    if (guard.response) return guard.response;
    const { supabaseAdmin, caller } = guard;

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const username = String(body?.username || email).trim();
    const fullName = body?.full_name == null ? "" : String(body.full_name).trim();
    const password = String(body?.password || "").trim() || randomPassword();
    const permissions = sanitizePermissions(body?.permissions);

    if (!email || !email.includes("@")) return json({ error: "email_required" }, 400, headers);
    if (!username) return json({ error: "username_required" }, 400, headers);
    if (password.length < 8) return json({ error: "weak_password" }, 400, headers);

    const { data: duplicateProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (duplicateProfile?.id) return json({ error: "username_exists" }, 409, headers);

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, full_name: fullName },
    });

    if (createError || !created?.user?.id) {
      return json({ error: "auth_user_create_failed" }, 400, headers);
    }
    createdUserId = created.user.id;

    const { error: profileInsertError } = await supabaseAdmin.from("profiles").insert({
      id: createdUserId,
      username,
      full_name: fullName,
      permissions,
      is_active: true,
    });

    if (profileInsertError) {
      try { await supabaseAdmin.auth.admin.deleteUser(createdUserId); } catch { /* best effort rollback */ }
      return json({ error: "profile_create_failed" }, 400, headers);
    }

    try {
      await supabaseAdmin.from("audit_log").insert({
        action: "إنشاء مستخدم",
        case_id: "",
        details: `username: ${username} | email: ${email}`,
        created_by: caller.id,
      });
    } catch {
      // Do not fail after user creation if audit insert is blocked.
    }

    return json({ ok: true, user_id: createdUserId }, 200, headers);
  } catch {
    return json({ error: "bad_request" }, 400, headers);
  }
});
