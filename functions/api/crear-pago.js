// Crea un pago en Mercado Pago (Checkout Pro) y devuelve el link para pagar.
// El Access Token vive solo acá, como secreto del proyecto. Nunca en la página.
const json = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { error: "Falta configurar MP_ACCESS_TOKEN" });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  const monto = Math.round(Number(b.monto));
  if (!(monto >= 500 && monto <= 300000)) return json(400, { error: "Monto fuera de rango" });

  const base = new URL(request.url).origin;
  const ref = "uder-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const pref = {
    items: [{ title: String(b.descripcion || "Viaje Uder").slice(0, 120), quantity: 1, unit_price: monto, currency_id: "ARS" }],
    payer: {
      name: String(b.nombre || "").slice(0, 60),
      surname: String(b.apellido || "").slice(0, 60),
      identification: { type: "DNI", number: String(b.dni || "").replace(/\D/g, "").slice(0, 8) }
    },
    back_urls: { success: base + "/?pago=ok", failure: base + "/?pago=error", pending: base + "/?pago=pendiente" },
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
