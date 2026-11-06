// Uder · funciones de cobro con Mercado Pago.
// La carpeta "public" se sirve sola. Este código solo atiende las direcciones que empiezan con /api/.
// Las claves (MP_ACCESS_TOKEN y SUPABASE_SECRET_KEY) se cargan como Secretos en Cloudflare.

const SB = "https://mmgvttmgchnbppcemrwg.supabase.co";
const json = (s, o) => new Response(JSON.stringify(o), { 
  status: s, 
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
});

async function crearPago(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { error: "Falta configurar MP_ACCESS_TOKEN" });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  const monto = Math.round(Number(b.monto));
  if (!(monto >= 500 && monto <= 300000)) return json(400, { error: "Monto fuera de rango" });

  const base = new URL(request.url).origin;
  const ref = "uder-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const pref = {
    items: [{ 
      title: String(b.descripcion || "Viaje Uder").slice(0, 120), 
      quantity: 1, 
      unit_price: monto, 
      currency_id: "ARS" 
    }],
    payer: {
      name: String(b.nombre || "").slice(0, 60),
      surname: String(b.apellido || "").slice(0, 60),
      identification: { type: "DNI", number: String(b.dni || "").replace(/\D/g, "").slice(0, 8) }
    },
    back_urls: { 
      success: base + "/?pago=ok", 
      failure: base + "/?pago=error", 
      pending: base + "/?pago=pendiente" 
    },
    auto_return: "approved",
    external_reference: ref,
    notification_url: base + "/api/webhook-mp"
  };

  try {
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(pref)
    });
    const j = await r.json();
    if (!r.ok) { 
      console.error("MP error", JSON.stringify(j)); 
      return json(502, { error: "Mercado Pago rechazó la solicitud" }); 
    }
    return json(200, { url: j.init_point, ref });
  } catch (e) {
    console.error(e);
    return json(502, { error: "No se pudo conectar con Mercado Pago" });
  }
}

async function verificarPago(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { aprobado: false, error: "Falta configurar MP_ACCESS_TOKEN" });

  const q = new URL(request.url).searchParams;
  const id = String(q.get("payment_id") || "").replace(/\D/g, "");
  const ref = q.get("ref") || "";
  const viaje = q.get("viaje") || "";

  if (!id) return json(400, { aprobado: false, error: "Falta payment_id" });

  try {
    // 1. Consultamos a Mercado Pago si el cobro se acreditó de verdad
    const mpRes = await fetch("https://api.mercadopago.com/v1/payments/" + id, {
      headers: { Authorization: "Bearer " + token }
    });
    const p = await mpRes.json();

    // Verificamos estado y que la referencia coincida si viene especificada
    const aprobado = (p.status === "approved") && (!ref || p.external_reference === ref);

    if (!aprobado) {
      return json(200, { aprobado: false, estado: p.status });
    }

    // 2. Si viene un ID de viaje y tenemos Supabase configurado, actualizamos la base de datos
    const key = env.SUPABASE_SECRET_KEY;
    if (viaje && key && /^[0-9a-f-]{36}$/i.test(viaje)) {
      try {
        const h = key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
        await fetch(`${SB}/rest/v1/viajes?id=eq.${viaje}&pago_estado=eq.pendiente`, {
          method: "PATCH",
          headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ pago_estado: "aprobado", mp_ref: ref || p.external_reference })
        });
      } catch (dbErr) {
        console.error("Error al actualizar Supabase:", dbErr);
      }
    }

    return json(200, { aprobado: true, estado: "approved" });
  } catch (e) {
    console.error(e);
    return json(502, { aprobado: false, error: "Error al verificar con Mercado Pago" });
  }
}

async function webhookMp(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  let id = new URL(request.url).searchParams.get("data.id");
  try { 
    const b = await request.json(); 
    if (!id && b && b.data) id = b.data.id; 
  } catch {}

  if (token && id) {
    try {
      const p = await (await fetch("https://api.mercadopago.com/v1/payments/" + id, { 
        headers: { Authorization: "Bearer " + token } 
      })).json();
      console.log("Pago", id, "estado:", p.status, "referencia:", p.external_reference, "monto:", p.transaction_amount);
    } catch (e) { 
      console.error(e); 
    }
  }
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/crear-pago" && request.method === "POST") return crearPago(request, env);
    if (pathname === "/api/verificar-pago" && request.method === "GET") return verificarPago(request, env);
    if (pathname === "/api/webhook-mp") return webhookMp(request, env);
    if (pathname.startsWith("/api/")) return json(404, { error: "No existe" });
    return env.ASSETS.fetch(request);
  }
};
