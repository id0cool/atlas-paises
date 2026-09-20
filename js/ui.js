/* ==========================================================================
   ui.js — Construcción de componentes del DOM a partir de los datos
   ========================================================================== */

const fmtEntero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const fmtDolares = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Escapa texto antes de insertarlo como HTML. */
export function escapar(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function urlBandera(iso2, ancho = 160) {
  return `https://flagcdn.com/w${ancho}/${iso2.toLowerCase()}.png`;
}

/** Si la bandera no existe en el CDN, se reemplaza por un recuadro con el código. */
function imagenBandera(pais, ancho, clase) {
  const img = document.createElement('img');
  img.className = clase;
  img.src = urlBandera(pais.iso2, ancho);
  img.alt = `Bandera de ${pais.nombre}`;
  img.loading = 'lazy';
  img.width = ancho;
  img.height = Math.round(ancho * 0.66);
  img.addEventListener('error', () => {
    const sustituto = document.createElement('div');
    sustituto.className = `${clase} bandera--vacia`;
    sustituto.textContent = pais.iso3;
    sustituto.setAttribute('role', 'img');
    sustituto.setAttribute('aria-label', `Sin bandera disponible para ${pais.nombre}`);
    img.replaceWith(sustituto);
  }, { once: true });
  return img;
}

/** Crea la tarjeta de un país. */
export function crearTarjeta(pais) {
  const li = document.createElement('li');
  li.className = 'tarjeta';

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'tarjeta-boton';
  boton.dataset.iso3 = pais.iso3;
  boton.setAttribute('aria-label', `Ver detalles de ${pais.nombre}`);

  boton.append(imagenBandera(pais, 160, 'bandera'));

  const cuerpo = document.createElement('div');
  cuerpo.className = 'tarjeta-cuerpo';
  cuerpo.innerHTML = `
    <h2 class="tarjeta-nombre">${escapar(pais.nombre)}</h2>
    <p class="tarjeta-dato"><span class="etiqueta">Capital:</span> ${escapar(pais.capital)}</p>
    <p class="chip chip--${escapar(pais.region.id)}">${escapar(pais.region.nombre)}</p>
    <p class="tarjeta-ingreso">${escapar(pais.ingreso.nombre)}</p>`;
  boton.append(cuerpo);

  li.append(boton);
  return li;
}

/** Dibuja la lista completa usando un DocumentFragment (un solo reflujo). */
export function renderLista(contenedor, paises) {
  const fragmento = document.createDocumentFragment();
  paises.forEach((p) => fragmento.append(crearTarjeta(p)));
  contenedor.replaceChildren(fragmento);
}

/** Muestra un estado (cargando, vacío o error) con su mensaje y un botón opcional. */
export function mostrarEstado(contenedor, { tipo, titulo, mensaje, accion }) {
  contenedor.hidden = false;
  contenedor.className = `estado estado--${tipo}`;
  const icono = { cargando: '<span class="spinner" aria-hidden="true"></span>', vacio: '🔎', error: '⚠️' }[tipo];
  contenedor.innerHTML = `
    <div class="estado-icono" aria-hidden="true">${icono}</div>
    <p class="estado-titulo">${escapar(titulo)}</p>
    ${mensaje ? `<p class="estado-mensaje">${escapar(mensaje)}</p>` : ''}`;
  if (accion) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn--primario';
    boton.textContent = accion.texto;
    boton.addEventListener('click', accion.alHacerClic, { once: true });
    contenedor.append(boton);
  }
}

export function ocultarEstado(contenedor) {
  contenedor.hidden = true;
  contenedor.replaceChildren();
}

/** Tarjetas de marcador mientras llegan los datos (skeleton). */
export function renderEsqueleto(contenedor, cantidad = 12) {
  const fragmento = document.createDocumentFragment();
  for (let i = 0; i < cantidad; i++) {
    const li = document.createElement('li');
    li.className = 'tarjeta tarjeta--esqueleto';
    li.setAttribute('aria-hidden', 'true');
    li.innerHTML = '<div class="bandera"></div><div class="tarjeta-cuerpo"><span></span><span></span><span></span></div>';
    fragmento.append(li);
  }
  contenedor.replaceChildren(fragmento);
}

/* ---------- Ficha de detalle ---------- */

export function renderDetalle(contenedor, pais) {
  const coordenadas = pais.latitud !== null
    ? `${fmtDecimal.format(pais.latitud)}°, ${fmtDecimal.format(pais.longitud)}°`
    : 'No disponible';

  contenedor.innerHTML = `
    <div class="detalle-encabezado">
      <div class="detalle-bandera"></div>
      <div>
        <h2 id="detalle-nombre">${escapar(pais.nombre)}</h2>
        <p class="detalle-original">${escapar(pais.nombreOriginal)} · ${escapar(pais.iso3)}</p>
      </div>
    </div>
    <dl class="detalle-datos">
      <div><dt>Capital</dt><dd>${escapar(pais.capital)}</dd></div>
      <div><dt>Región</dt><dd>${escapar(pais.region.nombre)}</dd></div>
      <div><dt>Nivel de ingreso</dt><dd>${escapar(pais.ingreso.nombre)}</dd></div>
      <div><dt>Coordenadas de la capital</dt><dd>${coordenadas}</dd></div>
    </dl>
    <h3 class="detalle-subtitulo">Indicadores más recientes</h3>
    <div id="detalle-indicadores" class="indicadores" aria-live="polite"></div>`;

  contenedor.querySelector('.detalle-bandera').append(imagenBandera(pais, 320, 'bandera bandera--grande'));
}

export function renderIndicadoresCargando(contenedor, indicadores) {
  contenedor.innerHTML = indicadores.map((ind) => `
    <div class="indicador indicador--cargando">
      <p class="indicador-nombre">${escapar(ind.nombre)}</p>
      <p class="indicador-valor"><span class="barra-carga"></span></p>
    </div>`).join('') + '<p class="visually-hidden">Cargando indicadores…</p>';
}

function formatear(valor, formato) {
  if (formato === 'dolares') return fmtDolares.format(valor);
  if (formato === 'decimal') return fmtDecimal.format(valor);
  return fmtEntero.format(valor);
}

export function renderIndicadores(contenedor, valores) {
  contenedor.innerHTML = valores.map((ind) => {
    const texto = ind.valor === null
      ? 'Sin datos'
      : formatear(ind.valor, ind.formato);
    const pie = ind.valor === null ? '' : `${escapar(ind.unidad)} · ${escapar(ind.anio)}`;
    return `
      <div class="indicador${ind.valor === null ? ' indicador--vacio' : ''}">
        <p class="indicador-nombre">${escapar(ind.nombre)}</p>
        <p class="indicador-valor">${escapar(texto)}</p>
        <p class="indicador-pie">${pie}</p>
      </div>`;
  }).join('');
}

export function renderIndicadoresError(contenedor, mensaje, alReintentar) {
  contenedor.innerHTML = `<div class="estado estado--error estado--compacto">
      <p class="estado-titulo">No se pudieron cargar los indicadores.</p>
      <p class="estado-mensaje">${escapar(mensaje)}</p>
    </div>`;
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn btn--secundario';
  boton.textContent = 'Reintentar';
  boton.addEventListener('click', alReintentar, { once: true });
  contenedor.querySelector('.estado').append(boton);
}
