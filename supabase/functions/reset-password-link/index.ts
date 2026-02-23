declare const Deno: any;
// @ts-ignore - Deno runtime supports URL imports; TS language service may not resolve it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

// Note: this is a Supabase Edge Function (Deno runtime)
Deno.serve(async (req: Request) => {
  try {
    const { email } = await req.json();
    const e = (email || "").toString().trim().toLowerCase();
    if (!e || !e.includes("@")) {
      return new Response(JSON.stringify({ error: "email_required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "missing_env" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(url, serviceRoleKey);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: e,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ action_link: data?.properties?.action_link || "" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
});
