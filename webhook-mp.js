// Mercado Pago avisa acá cuando cambia el estado de un pago.
// Por ahora solo lo registra en los logs de Netlify. Cuando armemos la base de datos, lo guardará.
exports.handler = async (event) => {
  const token = process.env.MP_ACCESS_TOKEN;
  let id = (event.queryStringParameters || {})["data.id"];
  try { const b = JSON.parse(event.body || "{}"); if (!id && b.data) id = b.data.id; } catch {}
  if (token && id) {
    try {
      const r = await fetch("https://api.mercadopago.com/v1/payments/" + id, { headers: { Authorization: "Bearer " + token } });
      const p = await r.json();
      console.log("Pago", id, "estado:", p.status, "referencia:", p.external_reference, "monto:", p.transaction_amount);
    } catch (e) { console.error(e); }
  }
  return { statusCode: 200, body: "ok" };
};
