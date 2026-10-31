// Confirma con Mercado Pago que el pago fue aprobado y recién ahí habilita el viaje para los conductores.
const SB = "https://mmgvttmgchnbppcemrwg.supabase.co";
const resp = (s, o) => ({ statusCode: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  const token = process.env.MP_ACCESS_TOKEN;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!token || !key) return resp(500, { aprobado: false, error: "Falta configurar las claves en Netlify" });
  const q = event.queryStringParameters || {};
  const id = String(q.payment_id || "").replace(/\D/g, "");
  const ref = q.ref || "";
  const viaje = q.viaje || "";
  if (!id || !ref || !/^[0-9a-f-]{36}$/i.test(viaje)) return resp(400, { aprobado: false });
  const h = key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
  try {
    const p = await (await fetch("https://api.mercadopago.com/v1/payments/" + id, { headers: { Authorization: "Bearer " + token } })).json();
    if (p.status !== "approved" || p.external_reference !== ref) return resp(200, { aprobado: false, estado: p.status });
    const v = (await (await fetch(`${SB}/rest/v1/viajes?id=eq.${viaje}&select=monto,pago_estado`, { headers: h })).json())[0];
    if (!v || Number(p.transaction_amount) < Number(v.monto)) return resp(200, { aprobado: false });
    const usado = await (await fetch(`${SB}/rest/v1/viajes?mp_ref=eq.${encodeURIComponent(ref)}&select=id`, { headers: h })).json();
    if (usado.length && usado[0].id !== viaje) return resp(200, { aprobado: false });
    const u = await fetch(`${SB}/rest/v1/viajes?id=eq.${viaje}&pago_estado=eq.pendiente`, {
      method: "PATCH", headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ pago_estado: "aprobado", mp_ref: ref })
    });
    return resp(200, { aprobado: u.ok || v.pago_estado === "aprobado" });
  } catch (e) {
    console.error(e);
    return resp(502, { aprobado: false });
  }
};
