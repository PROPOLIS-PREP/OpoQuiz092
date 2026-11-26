// Conexión del juego con Supabase (modo online, v2).
// Solo la URL del proyecto y la clave PUBLICABLE: puede ir en el navegador, porque lo que cada usuario
// puede leer o cambiar lo limitan las políticas RLS y las funciones del servidor.
// La clave secreta nunca va aquí ni en ningún archivo del repositorio.
// Proyecto: patrullan2-dev (desarrollo). Para producción se cambiarán estos dos valores.
window.PATRULLAN2_ONLINE = {
  url: "https://nuktczrndortdfgtnzdy.supabase.co",
  clave: "sb_publishable_2aIo3IDLvh0j0e0-qTnFaA_l5VFnpul",
  // DIAGNÓSTICO · QUITAR ANTES DE LA BETA: los errores sin mensaje propio enseñan su código y su mensaje reales
  // («[diagnóstico] código: mensaje») en lugar de «No se pudo completar. Inténtalo de nuevo.».
  diagnostico: true,
};
