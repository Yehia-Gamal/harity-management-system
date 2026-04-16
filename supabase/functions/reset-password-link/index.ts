declare const Deno: any;
import { corsHeaders, json, requireUsersManage } from "../_shared/security.ts";

Deno.serve(async (req: Request) => {
  const { headers, allowed } = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(allowed ? "ok" : "forbidden", { status: allowed ? 200 : 403, headers });
  }
  if (!allowed) return json({ error: "origin_not_allowed" }, 403, headers);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);

  try {
    const guard = await requireUsersManage(req, headers);
    if (guard.response) return guard.response;
    const { supabaseAdmin, caller } = guard;

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json({ error: "email_required" }, 400, headers);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
    });

    if (error) return json({ error: "reset_link_failed" }, 400, headers);

    try {
      await supabaseAdmin.from("audit_log").insert({
        action: "إنشاء رابط إعادة تعيين كلمة المرور",
        case_id: "",
        details: `target: ${email}`,
        created_by: caller.id,
      });
    } catch {
      // Audit failure must not expose internals or block the requested admin action.
    }

    return json({ ok: true, action_link: data?.properties?.action_link || "" }, 200, headers);
  } catch {
    return json({ error: "bad_request" }, 400, headers);
  }
});
