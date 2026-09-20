/* ==========================================================================
   api.js — Capa de acceso a la API de Indicadores del Banco Mundial (v2)
   Documentación: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
   No requiere clave; responde JSON con format=json y permite CORS.
   ========================================================================== */

const URL_BASE = 'https://api.worldbank.org/v2';
const TIEMPO_LIMITE = 12000; // ms

/** Error propio para distinguir el tipo de falla y mostrar un mensaje claro. */
export class ApiError extends Error {
  constructor(mensaje, tipo, estado = null) {
    super(mensaje);
    this.name = 'ApiError';
    this.tipo = tipo; // 'red' | 'tiempo' | 'http' | 'api' | 'formato'
    this.estado = estado; // código HTTP, si lo hay
  }
}

/** Un solo intento de petición: convierte cada tipo de falla en un ApiError con mensaje claro. */
async function pedirUnaVez(url) {
  // AbortController corta la petición si tarda demasiado
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_LIMITE);

  let respuesta;
  try {
    respuesta = await fetch(url, { signal: control.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError('El servidor tardó demasiado en responder. Intenta de nuevo.', 'tiempo');
    }
    throw new ApiError('No se pudo conectar con la API. Revisa tu conexión a internet.', 'red');
  } finally {
    clearTimeout(temporizador);
  }

  if (!respuesta.ok) {
    throw new ApiError(`La API respondió con el código HTTP ${respuesta.status}.`, 'http', respuesta.status);
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch {
    throw new ApiError('La respuesta de la API no es JSON válido.', 'formato');
  }

  // Error propio de la API (llega con estado 200)
  if (Array.isArray(datos) && datos[0]?.message) {
    const { id, value } = datos[0].message[0] ?? {};
    throw new ApiError(`La API devolvió el error ${id ?? '?'}: ${value ?? 'parámetro no válido'}.`, 'api');
  }

  if (!Array.isArray(datos) || datos.length < 2) {
    throw new ApiError('La respuesta de la API no tiene el formato esperado.', 'formato');
  }

  const [meta, filas] = datos;
  return { meta, filas: filas ?? [] };
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Solo vale la pena reintentar fallas temporales: red, tiempo agotado o error 5xx/429. */
const esTemporal = (e) => e.tipo === 'red' || e.tipo === 'tiempo'
  || (e.tipo === 'http' && (e.estado >= 500 || e.estado === 429));

/**
 * Hace una petición GET y devuelve { meta, filas }.
 * La API responde un arreglo de dos elementos: [metadatos de paginación, datos].
 * Cuando un parámetro no es válido responde [{ message: [{ id, key, value }] }].
 * Si la falla es temporal, reintenta hasta 2 veces esperando un poco más cada vez.
 */
async function pedir(ruta, parametros = {}, reintentos = 2) {
  const url = new URL(URL_BASE + ruta);
  url.search = new URLSearchParams({ format: 'json', ...parametros });

  for (let intento = 0; ; intento++) {
    try {
      return await pedirUnaVez(url);
    } catch (error) {
      if (intento >= reintentos || !esTemporal(error)) throw error;
      await esperar(700 * (intento + 1));
    }
  }
}

/* ---------- Traducciones y normalización ---------- */

const nombresES = new Intl.DisplayNames(['es'], { type: 'region' });

const REGIONES = {
  EAS: 'Asia oriental y el Pacífico',
  ECS: 'Europa y Asia central',
  LCN: 'América Latina y el Caribe',
  MEA: 'Oriente Medio, Norte de África, Afganistán y Pakistán',
  NAC: 'América del Norte',
  SAS: 'Asia meridional',
  SSF: 'África subsahariana',
};

const INGRESOS = {
  HIC: 'Ingreso alto',
  UMC: 'Ingreso mediano alto',
  LMC: 'Ingreso mediano bajo',
  LIC: 'Ingreso bajo',
  INX: 'Sin clasificar',
};

/** Nombre del país en español a partir del código ISO-2; si no existe, usa el de la API. */
function nombreEnEspanol(iso2, nombreApi) {
  try {
    const nombre = nombresES.of(iso2);
    return nombre && nombre !== iso2 ? nombre : nombreApi;
  } catch {
    return nombreApi;
  }
}

/** Convierte un registro de la API a un objeto más simple para la interfaz. */
function normalizarPais(p) {
  return {
    iso3: p.id,
    iso2: p.iso2Code,
    nombre: nombreEnEspanol(p.iso2Code, p.name),
    nombreOriginal: p.name,
    capital: p.capitalCity || 'Sin capital registrada',
    region: { id: p.region.id, nombre: REGIONES[p.region.id] ?? p.region.value.trim() },
    ingreso: { id: p.incomeLevel.id, nombre: INGRESOS[p.incomeLevel.id] ?? p.incomeLevel.value },
    latitud: p.latitude ? Number(p.latitude) : null,
    longitud: p.longitude ? Number(p.longitude) : null,
  };
}

/* ---------- Funciones públicas ---------- */

/**
 * GET /v2/country?format=json&per_page=400
 * Devuelve solo países: descarta los agregados (regiones, grupos de ingreso),
 * que la API marca con region.id === "NA".
 * @param {string} [codigo] permite pedir un código específico (se usa para probar errores).
 */
export async function obtenerPaises(codigo = '') {
  const ruta = codigo ? `/country/${codigo}` : '/country';
  const { filas } = await pedir(ruta, { per_page: 400 });
  return filas.filter((p) => p.region.id !== 'NA').map(normalizarPais);
}

export const INDICADORES = [
  { id: 'SP.POP.TOTL', nombre: 'Población', formato: 'entero', unidad: 'habitantes' },
  { id: 'NY.GDP.PCAP.CD', nombre: 'PIB per cápita', formato: 'dolares', unidad: 'USD actuales' },
  { id: 'SP.DYN.LE00.IN', nombre: 'Esperanza de vida', formato: 'decimal', unidad: 'años' },
  { id: 'AG.SRF.TOTL.K2', nombre: 'Superficie', formato: 'entero', unidad: 'km²' },
];

const cacheIndicadores = new Map();

/**
 * GET /v2/country/{iso3}/indicator/{id1;id2;id3;id4}?format=json&source=2&mrnev=1
 * Una sola petición trae los cuatro indicadores (se separan con ";" y se indica la fuente 2,
 * World Development Indicators). mrnev=1 pide el valor más reciente que no esté vacío.
 * Si un indicador no tiene datos para ese país, simplemente no aparece en la respuesta.
 */
export async function obtenerIndicadores(iso3) {
  if (cacheIndicadores.has(iso3)) return cacheIndicadores.get(iso3);

  const ids = INDICADORES.map((ind) => ind.id).join(';');
  const { filas } = await pedir(`/country/${iso3}/indicator/${ids}`, { source: 2, mrnev: 1, per_page: 50 });

  const porId = new Map(filas.map((f) => [f.indicator.id, f]));
  const valores = INDICADORES.map((ind) => ({
    ...ind,
    valor: porId.get(ind.id)?.value ?? null,
    anio: porId.get(ind.id)?.date ?? null,
  }));

  cacheIndicadores.set(iso3, valores);
  return valores;
}
