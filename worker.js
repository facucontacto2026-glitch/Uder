// Uder · Backend en Cloudflare Workers
const SB = "https://mmgvttmgchnbppcemrwg.supabase.co";

const json = (s, o) => new Response(JSON.stringify(o), { 
  status: s, 
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
});

function sbHeaders(key) {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
}

// 1. Crear cobro con Mercado Pago
async function crearPago(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { error: "Falta configurar MP_ACCESS_TOKEN" });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  const monto = Math.round(Number(b.monto));
  if (!(monto >= 500 && monto <= 300000)) return json(400, { error: "Monto fuera de rango" });

  const base = new URL(request.url).origin;
  const ref = "uder-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const viajeId = b.viaje_id || "";

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
      success: base + "/?pago=ok" + (viajeId ? "&viaje=" + viajeId : ""), 
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
    if (!r.ok) { console.error("MP error", JSON.stringify(j)); return json(502, { error: "Mercado Pago rechazó la solicitud" }); }
    return json(200, { url: j.init_point, ref });
  } catch (e) {
    console.error(e);
    return json(502, { error: "No se pudo conectar con Mercado Pago" });
  }
}

// 2. Verificar cobro con Mercado Pago
async function verificarPago(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { aprobado: false, error: "Falta configurar MP_ACCESS_TOKEN" });

  const q = new URL(request.url).searchParams;
  const id = String(q.get("payment_id") || "").replace(/\D/g, "");
  const ref = q.get("ref") || "";
  const viaje = q.get("viaje") || "";

  if (!id) return json(400, { aprobado: false, error: "Falta payment_id" });

  try {
    const mpRes = await fetch("https://api.mercadopago.com/v1/payments/" + id, {
      headers: { Authorization: "Bearer " + token }
    });
    const p = await mpRes.json();
    const aprobado = (p.status === "approved") && (!ref || p.external_reference === ref);

    if (!aprobado) return json(200, { aprobado: false, estado: p.status });

    const key = env.SUPABASE_SECRET_KEY;
    if (viaje && key && /^[0-9a-f-]{36}$/i.test(viaje)) {
      try {
        const h = { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "return=minimal" };
        await fetch(`${SB}/rest/v1/viajes?id=eq.${viaje}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ pago_estado: "aprobado", estado: "buscando", mp_ref: ref || p.external_reference })
        });
      } catch (dbErr) {
        console.error("Error en Supabase:", dbErr);
      }
    }

    return json(200, { aprobado: true, estado: "approved" });
  } catch (e) {
    console.error(e);
    return json(502, { aprobado: false, error: "Error de verificación" });
  }
}

// 3. Crear viaje en Supabase
async function pedirViaje(request, env) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return json(500, { error: "Falta SUPABASE_SECRET_KEY" });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  try {
    const h = { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "return=representation" };
    const r = await fetch(`${SB}/rest/v1/viajes`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(b)
    });
    const data = await r.json();
    if (!r.ok) { console.error("DB error", data); return json(500, { error: "No se pudo crear el viaje" }); }
    return json(200, { viaje: data[0] });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Error al guardar el viaje" });
  }
}

// 4. Consultar estado del viaje y posición del chofer
async function estadoViaje(request, env) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return json(500, { error: "Falta SUPABASE_SECRET_KEY" });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json(400, { error: "Falta id" });

  try {
    const h = sbHeaders(key);
    const r = await fetch(`${SB}/rest/v1/viajes?id=eq.${id}&select=*`, { headers: h });
    const lista = await r.json();
    const v = lista && lista[0];
    if (!v) return json(404, { error: "Viaje no encontrado" });

    let condPos = null;
    if (v.conductor_id) {
      const cr = await fetch(`${SB}/rest/v1/conductores?id=eq.${v.conductor_id}&select=lat,lng,actualizado_en`, { headers: h });
      const cdata = await cr.json();
      if (cdata && cdata[0]) condPos = cdata[0];
    }

    return json(200, { viaje: v, conductor_pos: condPos });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Error de consulta" });
  }
}

// 5. Cancelar viaje
async function cancelarViaje(request, env) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return json(500, { error: "Falta SUPABASE_SECRET_KEY" });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }
  if (!b.id) return json(400, { error: "Falta id" });

  try {
    const h = { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "return=minimal" };
    await fetch(`${SB}/rest/v1/viajes?id=eq.${b.id}&estado=in.(buscando,aceptado)`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ estado: "cancelado" })
    });
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: "No se pudo cancelar" });
  }
}

async function webhookMp(request, env) {
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Rutas de API
    if (pathname === "/api/crear-pago" && request.method === "POST") return crearPago(request, env);
    if (pathname === "/api/verificar-pago" && request.method === "GET") return verificarPago(request, env);
    if (pathname === "/api/pedir-viaje" && request.method === "POST") return pedirViaje(request, env);
    if (pathname === "/api/estado-viaje" && request.method === "GET") return estadoViaje(request, env);
    if (pathname === "/api/cancelar-viaje" && request.method === "POST") return cancelarViaje(request, env);
    if (pathname === "/api/webhook-mp") return webhookMp(request, env);
    if (pathname.startsWith("/api/")) return json(404, { error: "No existe" });

    // Rutas amigables sin .html
    if (pathname === "/conductor" || pathname === "/conductor/") {
      url.pathname = "/conductor.html";
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (pathname === "/admin" || pathname === "/admin/") {
      url.pathname = "/admin.html";
      return env.ASSETS.fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  }
};
