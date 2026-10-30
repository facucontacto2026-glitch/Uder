// Confirma con Mercado Pago que un pago realmente fue aprobado (no confía en lo que diga la URL).
const resp = (s, o) => ({ statusCode: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return resp(500, { error: "Falta configurar MP_ACCESS_TOKEN" });
  const id = String((event.queryStringParameters || {}).payment_id || "").replace(/\D/g, "");
  const ref = (event.queryStringParameters || {}).ref || "";
  if (!id || !ref) return resp(400, { aprobado: false });
  try {
    const r = await fetch("https://api.mercadopago.com/v1/payments/" + id, { headers: { Authorization: "Bearer " + token } });
    const p = await r.json();
    return resp(200, { aprobado: r.ok && p.status === "approved" && p.external_reference === ref, estado: p.status });
  } catch (e) {
    console.error(e);
    return resp(502, { aprobado: false });
  }
};
