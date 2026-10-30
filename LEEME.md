# Uder · Cobros con Mercado Pago

Contenido:
- public/index.html → la app del pasajero
- netlify/functions/ → 3 funciones que hablan con Mercado Pago (crear pago, verificar pago, aviso de pagos)
- netlify.toml → configuración

## Pasos
1. Mercado Pago: entrá a "Tus integraciones" (mercadopago.com.ar/developers), creá una aplicación de tipo Checkout Pro y copiá el Access Token de PRUEBA (después usás el de producción).
2. GitHub: creá una cuenta gratis, un repositorio nuevo y subí todo este contenido (Add file → Upload files, arrastrando las carpetas).
3. Netlify: Add new project → Import from Git → elegí ese repositorio. No cambies nada y desplegá.
4. En Netlify: Site configuration → Environment variables → agregá MP_ACCESS_TOKEN con tu Access Token. Después hacé "Trigger deploy".
5. Probá un viaje con Mercado Pago usando las tarjetas y usuarios de prueba de Mercado Pago. Recién cuando ande, cambiá al Access Token de producción.

IMPORTANTE: el Access Token es como la contraseña de tu cuenta. No lo pegues en la página, en el chat ni en GitHub.
