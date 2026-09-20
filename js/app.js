/* ==========================================================================
   app.js — Estado de la aplicación, filtros, paginación y eventos
   ========================================================================== */

import { obtenerPaises, obtenerIndicadores, INDICADORES } from './api.js';
import {
  renderLista, renderEsqueleto, mostrarEstado, ocultarEstado,
  renderDetalle, renderIndicadoresCargando, renderIndicadores, renderIndicadoresError,
} from './ui.js';

const POR_PAGINA = 12;

/* ---------- Estado ---------- */
const estado = {
  paises: [],
  busqueda: '',
  region: '',
  ingreso: '',
  orden: 'nombre-asc',
  pagina: 1,
};

/* ---------- Referencias al DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const form = $('#form-filtros');
const inputBusqueda = $('#busqueda');
const selRegion = $('#region');
const selIngreso = $('#ingreso');
const selOrden = $('#orden');
const lista = $('#lista-paises');
const cajaEstado = $('#estado');
const contador = $('#contador');
const paginacion = $('#paginacion');
const infoPagina = $('#info-pagina');
const btnAnterior = $('#btn-anterior');
const btnSiguiente = $('#btn-siguiente');
const dialogo = $('#detalle');
const contenidoDetalle = $('#detalle-contenido');

/* ---------- Utilidades ---------- */

/** Minúsculas y sin acentos, para que "mexico" encuentre "México". */
const normalizar = (texto) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Ejecuta la función solo cuando el usuario deja de escribir. */
function debounce(fn, espera = 250) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), espera);
  };
}

/** Llena un <select> con las opciones únicas encontradas en los datos. */
function llenarSelect(select, pares) {
  const unicos = new Map(pares);
  [...unicos]
    .sort((a, b) => a[1].localeCompare(b[1], 'es'))
    .forEach(([valor, texto]) => select.add(new Option(texto, valor)));
}

/* ---------- Consultas ---------- */

function obtenerVisibles() {
  const termino = normalizar(estado.busqueda);
  const filtrados = estado.paises.filter((p) => {
    const coincideTexto = !termino
      || normalizar(p.nombre).includes(termino)
      || normalizar(p.nombreOriginal).includes(termino)
      || normalizar(p.capital).includes(termino);
    const coincideRegion = !estado.region || p.region.id === estado.region;
    const coincideIngreso = !estado.ingreso || p.ingreso.id === estado.ingreso;
    return coincideTexto && coincideRegion && coincideIngreso;
  });

  const [campo, direccion] = estado.orden.split('-');
  const factor = direccion === 'desc' ? -1 : 1;
  return filtrados.sort((a, b) => factor * a[campo].localeCompare(b[campo], 'es'));
}

/* ---------- Render principal ---------- */

function render() {
  const visibles = obtenerVisibles();
  const total = visibles.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  estado.pagina = Math.min(estado.pagina, paginas);

  if (total === 0) {
    lista.replaceChildren();
    paginacion.hidden = true;
    contador.textContent = '0 países encontrados';
    const detalle = estado.busqueda ? ` que coincidan con «${estado.busqueda}»` : ' con esos filtros';
    mostrarEstado(cajaEstado, {
      tipo: 'vacio',
      titulo: `No encontramos países${detalle}.`,
      mensaje: 'Revisa la ortografía, prueba con la capital o quita algún filtro.',
      accion: { texto: 'Limpiar filtros', alHacerClic: limpiarFiltros },
    });
    return;
  }

  ocultarEstado(cajaEstado);
  const inicio = (estado.pagina - 1) * POR_PAGINA;
  const pagina = visibles.slice(inicio, inicio + POR_PAGINA);
  renderLista(lista, pagina);

  contador.textContent = total === 1
    ? 'Se encontró 1 país'
    : `Mostrando ${inicio + 1}–${inicio + pagina.length} de ${total} países`;
  paginacion.hidden = paginas === 1;
  infoPagina.textContent = `Página ${estado.pagina} de ${paginas}`;
  btnAnterior.disabled = estado.pagina === 1;
  btnSiguiente.disabled = estado.pagina === paginas;
}

/* ---------- Carga inicial ---------- */

/**
 * Para demostrar el manejo de errores sin desconectar el equipo:
 *   ?simular=error-api  → pide un código de país inexistente (la API responde error 120)
 *   ?simular=sin-red    → apunta a una ruta que no existe (fetch falla)
 */
function codigoDePrueba() {
  const modo = new URLSearchParams(location.search).get('simular');
  if (modo === 'error-api') return 'XXX';
  if (modo === 'sin-red') return '../noexiste';
  return '';
}

async function cargarPaises() {
  renderEsqueleto(lista);
  paginacion.hidden = true;
  contador.textContent = '';
  mostrarEstado(cajaEstado, {
    tipo: 'cargando',
    titulo: 'Cargando países…',
    mensaje: 'Consultando la API del Banco Mundial.',
  });
  form.inert = true;

  try {
    estado.paises = await obtenerPaises(codigoDePrueba());
    if (estado.paises.length === 0) {
      throw new Error('La API no devolvió países.');
    }
    llenarSelect(selRegion, estado.paises.map((p) => [p.region.id, p.region.nombre]));
    llenarSelect(selIngreso, estado.paises.map((p) => [p.ingreso.id, p.ingreso.nombre]));
    form.inert = false;
    render();
  } catch (error) {
    console.error(error);
    lista.replaceChildren();
    mostrarEstado(cajaEstado, {
      tipo: 'error',
      titulo: 'No pudimos cargar la lista de países.',
      mensaje: error.message,
      accion: { texto: 'Reintentar', alHacerClic: cargarPaises },
    });
  }
}

/* ---------- Detalle ---------- */

async function abrirDetalle(iso3) {
  const pais = estado.paises.find((p) => p.iso3 === iso3);
  if (!pais) return;

  renderDetalle(contenidoDetalle, pais);
  dialogo.showModal();
  await cargarIndicadores(pais);
}

async function cargarIndicadores(pais) {
  const caja = contenidoDetalle.querySelector('#detalle-indicadores');
  renderIndicadoresCargando(caja, INDICADORES);
  try {
    const valores = await obtenerIndicadores(pais.iso3);
    renderIndicadores(caja, valores);
  } catch (error) {
    renderIndicadoresError(caja, error.message, () => cargarIndicadores(pais));
  }
}

/* ---------- Eventos ---------- */

function limpiarFiltros() {
  inputBusqueda.value = '';
  selRegion.value = '';
  selIngreso.value = '';
  selOrden.value = 'nombre-asc';
  Object.assign(estado, { busqueda: '', region: '', ingreso: '', orden: 'nombre-asc', pagina: 1 });
  render();
  inputBusqueda.focus();
}

inputBusqueda.addEventListener('input', debounce(() => {
  estado.busqueda = inputBusqueda.value;
  estado.pagina = 1;
  render();
}));

form.addEventListener('change', (e) => {
  if (e.target === inputBusqueda) return;
  estado.region = selRegion.value;
  estado.ingreso = selIngreso.value;
  estado.orden = selOrden.value;
  estado.pagina = 1;
  render();
});

form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('reset', (e) => {
  e.preventDefault();
  limpiarFiltros();
});

btnAnterior.addEventListener('click', () => {
  estado.pagina--;
  render();
  lista.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

btnSiguiente.addEventListener('click', () => {
  estado.pagina++;
  render();
  lista.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Delegación de eventos: un solo listener para todas las tarjetas
lista.addEventListener('click', (e) => {
  const boton = e.target.closest('.tarjeta-boton');
  if (boton) abrirDetalle(boton.dataset.iso3);
});

// Cerrar la ficha al hacer clic fuera de ella
dialogo.addEventListener('click', (e) => {
  if (e.target === dialogo) dialogo.close();
});

/* ---------- Inicio ---------- */
cargarPaises();
