// Uder · Backend en Cloudflare Workers (Mercado Pago + Supabase + IA Gemini)
const SB = "https://mmgvttmgchnbppcemrwg.supabase.co";

const json = (s, o) => new Response(JSON.stringify(o), { 
  status: s, 
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
});

function sbHeaders(key) {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
}

// Convertir ArrayBuffer a Base64 sin desbordar memoria
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
  }
  return btoa(binary);
}

// Iconos vectoriales
function servirIcono(tipo) {
  if (tipo === "admin") {
    const svgAdmin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <rect width="512" height="512" rx="100" fill="#000000"/>
      <circle cx="256" cy="235" r="150" fill="#F5B700"/>
      <path d="M256 140 L340 180 L340 260 C340 310 256 345 256 345 C256 345 172 310 172 260 L172 180 Z" fill="#000000"/>
      <text x="256" y="270" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="90" fill="#F5B700" text-anchor="middle">U</text>
      <text x="256" y="450" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="44" fill="#F5B700" text-anchor="middle" letter-spacing="4">ADMIN</text>
    </svg>`;
    return new Response(svgAdmin, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
  }

  const esChofer = (tipo === "conductor");
  const fondoExterior = esChofer ? "#F5B700" : "#14213D";
  const circuloCentro = esChofer ? "#14213D" : "#F5B700";
  const letraColor    = esChofer ? "#F5B700" : "#14213D";
  const textoColor    = esChofer ? "#14213D" : "#FFFFFF";
  const etiqueta      = esChofer ? "CHOFER" : "UDER";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" rx="100" fill="${fondoExterior}"/>
    <circle cx="256" cy="235" r="150" fill="${circuloCentro}"/>
    <text x="256" y="305" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="200" fill="${letraColor}" text-anchor="middle">U</text>
    <text x="256" y="450" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="46" fill="${textoColor}" text-anchor="middle" letter-spacing="4">${etiqueta}</text>
  </svg>`;

  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}

// 1. VERIFICADOR INTELIGENTE CON IA (GOOGLE GEMINI 1.5 FLASH VISION)
async function verificarDocumentosAI(request, env) {
  const geminiKey = env.GEMINI_API_KEY;
  const sbKey = env.SUPABASE_SECRET_KEY;
  if (!geminiKey || !sbKey) return json(500, { error: "Faltan claves de configuración (GEMINI o SUPABASE)" });

  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  const cid = b.conductor_id;
  const nombreChofer = `${b.nombre || ''} ${b.apellido || ''}`.trim();
  const vehiculo = b.vehiculo || '';
  const patente = b.patente || '';
  const docs = b.docs || []; // [{ tipo: "licencia", path: "..." }, ...]

  if (!cid || !docs.length) return json(400, { error: "Faltan documentos para analizar" });

  const h = sbHeaders(sbKey);
  const inlineImages = [];

  // Descargar las imágenes de los documentos desde Supabase Storage
  for (const doc of docs) {
    try {
      const resImg = await fetch(`${SB}/storage/v1/object/documentos/${doc.path}`, { headers: h });
      if (resImg.ok) {
        const buf = await resImg.arrayBuffer();
        const base64Data = arrayBufferToBase64(buf);
        inlineImages.push({
          inline_data: {
            mime_type: resImg.headers.get("content-type") || "image/jpeg",
            data: base64Data
          }
        });
      }
    } catch(errImg) {
      console.error("Error descargando doc:", doc.path, errImg);
    }
  }

  if (!inlineImages.length) {
    return json(400, { error: "No se pudieron descargar las imágenes para la IA" });
  }

  // Prompt oficial con análisis de normativas argentinas
  const prompt = `Eres el perito auditor de Inteligencia Artificial de la aplicación de transporte UDER en Rosario de la Frontera, Salta, Argentina.
Tu tarea es verificar rigurosamente la documentación presentada por un chofer para decidir si se le autoriza a trabajar de inmediato.

Datos declarados por el chofer:
- Nombre y Apellido: ${nombreChofer}
- Vehículo declarado: ${vehiculo}
- Patente declarada: ${patente}

Se te adjuntan las fotografías de los 4 documentos (Licencia de conducir, Cédula de identificación del automotor, Póliza de Seguro y Revisión Técnica Obligatoria VTV/RTO).

Debes inspeccionar y responder ÚNICAMENTE un objeto JSON válido con la siguiente estructura exacta:
{
  "aprobado": true o false,
  "motivo": "Explicación breve y cordial si es rechazado (ej. 'La póliza de seguro está vencida' o 'La foto de la licencia no se lee bien'), o 'Documentación aprobada y en regla' si cumple todo",
  "confianza": 0 a 100,
  "detalles": {
    "licencia_legible": true/false,
    "licencia_vigente": true/false,
    "identidad_coincide": true/false,
    "patente_coincide": true/false,
    "seguro_vigente": true/false,
    "vtv_vigente": true/false
  }
}

Reglas estrictas:
1. Si un documento crucial está visiblemente vencido, "aprobado" debe ser false.
2. Si las fotos son de objetos no relacionados o completamente borrosas, "aprobado" debe ser false.
3. Si los documentos son legibles, vigentes y coinciden con la identidad y el vehículo, "aprobado" debe ser true.`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const geminiPayload = {
      contents: [{
        parts: [
          { text: prompt },
          ...inlineImages
        ]
      }],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.1
      }
    };

    const rGemini = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload)
    });

    const jGemini = await rGemini.json();
    if (!rGemini.ok) {
      console.error("Gemini Error:", jGemini);
      return json(502, { error: "La IA no pudo procesar las fotos en este momento" });
    }

    const aiRawText = jGemini.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const veredicto = JSON.parse(aiRawText);

    // Actualizar Supabase con el resultado de la IA
    const esAprobado = (veredicto.aprobado === true);
    await fetch(`${SB}/rest/v1/conductores?id=eq.${cid}`, {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        verificado: esAprobado,
        estado_revision: esAprobado ? "aprobado" : "rechazado",
        motivo_rechazo: esAprobado ? null : (veredicto.motivo || "Documentación no aprobada")
      })
    });

    return json(200, {
      aprobado: esAprobado,
      motivo: veredicto.motivo,
      detalles: veredicto.detalles
    });

  } catch(e) {
    console.error("Error general IA:", e);
    return json(500, { error: "Error en el análisis de IA" });
  }
}

// 2. Buscador de calles
async function buscarCalle(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return json(200, { resultados: [] });
  const numMatch = q.match(/\b\d{1,5}\b/);
  const num = numMatch ? numMatch[0] : "";
  let resultados = [];

  try {
    const geoUrl = `https://apis.datos.gob.ar/georef/api/v2.0/direcciones?max=6&provincia=salta&departamento=rosario%20de%20la%20frontera&direccion=${encodeURIComponent(q)}`;
    const gr = await fetch(geoUrl);
    const gj = await gr.json();
    if (gj.direcciones && gj.direcciones.length) {
      gj.direcciones.forEach(d => {
        if (d.ubicacion && d.ubicacion.lat != null) {
          resultados.push({
            lat: parseFloat(d.ubicacion.lat),
            lng: parseFloat(d.ubicacion.lon),
            nombre: d.nomenclatura ? d.nomenclatura.split(",")[0] : q,
            num: num
          });
        }
      });
    }
  } catch(e) {}

  if (!resultados.length) {
    try {
      const viewbox = "-65.05,-25.75,-64.90,-25.86";
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ar&viewbox=${viewbox}&bounded=0&limit=6&q=${encodeURIComponent(q + ", Rosario de la Frontera, Salta")}`;
      const nr = await fetch(nomUrl, { headers: { "User-Agent": "Uder-App/1.0" } });
      const ndata = await nr.json();
      if (Array.isArray(ndata) && ndata.length) {
        ndata.forEach(x => {
          resultados.push({
            lat: parseFloat(x.lat),
            lng: parseFloat(x.lon),
            nombre: x.display_name.split(",").slice(0, 3).join(","),
            num: num
          });
        });
      }
    } catch(e) {}
  }

  return json(200, { resultados });
}

// 3. Débito transparente con tarjeta
async function procesarPagoTarjeta(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { error: "Falta configurar MP_ACCESS_TOKEN" });

  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  const monto = Math.round(Number(b.monto));
  if (!(monto >= 500 && monto <= 300000)) return json(400, { error: "Monto fuera de rango" });
  if (!b.token) return json(400, { error: "Falta token de tarjeta" });

  const paymentData = {
    transaction_amount: monto,
    token: b.token,
    description: String(b.descripcion || "Viaje Uder").slice(0, 120),
    installments: 1,
    payer: {
      email: b.email || "pasajero@uder.app",
      identification: {
        type: "DNI",
        number: String(b.dni || "0").replace(/\D/g, "").slice(0, 8)
      }
    },
    statement_descriptor: "UDER VIAJES",
    external_reference: "uder-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
  };

  try {
    const r = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": "uder-pay-" + (b.viaje_id || Date.now())
      },
      body: JSON.stringify(paymentData)
    });
    const j = await r.json();

    if (r.ok && j.status === "approved") {
      const key = env.SUPABASE_SECRET_KEY;
      if (b.viaje_id && key && /^[0-9a-f-]{36}$/i.test(b.viaje_id)) {
        try {
          const h = { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "return=minimal" };
          await fetch(`${SB}/rest/v1/viajes?id=eq.${b.viaje_id}`, {
            method: "PATCH",
            headers: h,
            body: JSON.stringify({ pago_estado: "aprobado", mp_ref: String(j.id) })
          });
        } catch(e) {}
      }
      return json(200, { aprobado: true, id: j.id, estado: "approved" });
    } else {
      const motivo = j.status_detail || j.message || "Pago rechazado por el banco";
      return json(200, { aprobado: false, estado: j.status, detalle: motivo });
    }
  } catch (e) {
    return json(502, { error: "Error de conexión con Mercado Pago" });
  }
}

// 4. Checkout Pro
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
    if (!r.ok) return json(502, { error: "Mercado Pago rechazó la solicitud" });
    return json(200, { url: j.init_point, ref });
  } catch (e) {
    return json(502, { error: "No se pudo conectar con Mercado Pago" });
  }
}

// 5. Verificar cobro
async function verificarPago(request, env) {
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { aprobado: false, error: "Falta configurar MP_ACCESS_TOKEN" });

  const q = new URL(request.url).searchParams;
  const id = String(q.get("payment_id") || "").replace(/\D/g, "");
  const ref = q.get("ref") || "";
  const viaje = q.get("viaje") || "";

  if (!id) return json(400, { aprobado: false });

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
      } catch (dbErr) {}
    }

    return json(200, { aprobado: true, estado: "approved" });
  } catch (e) {
    return json(502, { aprobado: false });
  }
}

// 6. Crear viaje en Supabase
async function pedirViaje(request, env) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return json(500, { error: "Falta SUPABASE_SECRET_KEY" });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos" }); }

  const h = { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "return=representation" };

  if (b.pasajero_id) {
    try {
      const cp = await fetch(`${SB}/rest/v1/perfiles?id=eq.${b.pasajero_id}&select=id`, { headers: h });
      const pData = await cp.json();
      if (!pData || !pData.length) {
        await fetch(`${SB}/rest/v1/perfiles`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ id: b.pasajero_id, rol: "pasajero", nombre: b.pasajero_nombre || "Pasajero" })
        });
      }
    } catch(errPerfil) {
      delete b.pasajero_id;
    }
  }

  try {
    const r = await fetch(`${SB}/rest/v1/viajes`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(b)
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("DB error:", data);
      return json(500, { error: "No se pudo crear el viaje", detalle: data });
    }
    return json(200, { viaje: data[0] });
  } catch (e) {
    return json(500, { error: "Error al guardar el viaje" });
  }
}

// 7. Consultar estado del viaje
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
    return json(500, { error: "Error de consulta" });
  }
}

// 8. Cancelar viaje
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

    // Iconos de las 3 apps
    if (pathname === "/icon-pasajero.svg" || pathname === "/icon-pasajero.png") return servirIcono("pasajero");
    if (pathname === "/icon-conductor.svg" || pathname === "/icon-conductor.png") return servirIcono("conductor");
    if (pathname === "/icon-admin.svg" || pathname === "/icon-admin.png") return servirIcono("admin");

    // Rutas de API
    if (pathname === "/api/verificar-documentos-ai" && request.method === "POST") return verificarDocumentosAI(request, env);
    if (pathname === "/api/buscar-calle" && request.method === "GET") return buscarCalle(request);
    if (pathname === "/api/procesar-pago-tarjeta" && request.method === "POST") return procesarPagoTarjeta(request, env);
    if (pathname === "/api/crear-pago" && request.method === "POST") return crearPago(request, env);
    if (pathname === "/api/verificar-pago" && request.method === "GET") return verificarPago(request, env);
    if (pathname === "/api/pedir-viaje" && request.method === "POST") return pedirViaje(request, env);
    if (pathname === "/api/estado-viaje" && request.method === "GET") return estadoViaje(request, env);
    if (pathname === "/api/cancelar-viaje" && request.method === "POST") return cancelarViaje(request, env);
    if (pathname === "/api/webhook-mp") return webhookMp(request, env);
    if (pathname.startsWith("/api/")) return json(404, { error: "No existe" });

    // Rutas limpias
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
