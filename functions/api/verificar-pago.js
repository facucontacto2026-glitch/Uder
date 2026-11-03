// Confirma con Mercado Pago que el pago fue aprobado y recién ahí habilita el viaje para los conductores.
const SB = "https://mmgvttmgchnbppcemrwg.supabase.co";
const json = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequestGet({ request, env }) {
  const token = env.MP_ACCESS_TOKEN;
  const key = env.SUPABASE_SECRET_KEY;
  if (!token || !key) return json(500, { aprobado: false, error: "Faltan configurar las claves" });
  const q = new URL(request.url).searchParams;
  const id = String(q.get("payment_id") || "").replace(/\D/g, "");
  const ref = q.get("ref") || "";
  const viaje = q.get("viaje") || "";
  if (!id || !ref || !/^[0-9a-f-]{36}$/i.test(viaje)) return json(400, { aprobado: false });
  const h = key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
  try {
    const p = await (await fetch("https://api.mercadopago.com/v1/payments/" + id, { headers: { Authorization: "Bearer " + token } })).json();
    if (p.status !== "approved" || p.external_reference !== ref) return json(200, { aprobado: false, estado: p.status });
    const v = (await (await fetch(`${SB}/rest/v1/viajes?id=eq.${viaje}&select=monto,pago_estado`, { headers: h })).json())[0];
    if (!v || Number(p.transaction_amount) < Number(v.monto)) return json(200, { aprobado: false });
    const usado = await (await fetch(`${SB}/rest/v1/viajes?mp_ref=eq.${encodeURIComponent(ref)}&select=id`, { headers: h })).json();
    if (usado.length && usado[0].id !== viaje) return json(200, { aprobado: false });
    const u = await fetch(`${SB}/rest/v1/viajes?id=eq.${viaje}&pago_estado=eq.pendiente`, {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ pago_estado: "aprobado", mp_ref: ref })
    });
    return json(200, { aprobado: u.ok || v.pago_estado === "aprobado" });
  } catch (e) {
    console.error(e);
    return json(502, { aprobado: false });
  }
}
