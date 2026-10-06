// =====================================================
// GOOGLE APPS SCRIPT - Backend Gestión Camisetas v2
// =====================================================
// INSTRUCCIONES:
// 1. Abrí https://script.google.com y creá un nuevo proyecto
// 2. Pegá este código completo reemplazando todo lo existente
// 3. Cargá el ID de la planilla como propiedad del script (NO va en el código):
//    Configuración del proyecto (el engranaje) > Propiedades del script > Agregar propiedad
//      Propiedad: SPREADSHEET_ID
//      Valor:     el ID de tu Google Sheet (lo que va entre /d/ y /edit en su dirección)
// 4. Ejecutá una vez la función probarConfiguracion desde el editor: tiene que mostrar el
//    nombre de la planilla. Si da error, la propiedad falta o está mal copiada.
// 5. La planilla tiene que tener la hoja "Pedidos". "Compras" y "Movimientos" se crean solas.
// 6. Deploy > New deployment > Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 7. Copiá la URL del deployment y pegala en la webapp
// 8. Clave de acceso (recomendado): agregá la propiedad CLAVE_ACCESO con la clave que quieras,
//    o ejecutá una vez generarClaveAcceso para que arme una. Desde ese momento sólo entra
//    quien la sepa. Ver más abajo, "CLAVE DE ACCESO".
// 9. Usuarios (optativo): ejecutá una vez crearHojaUsuarios y cargá ahí a las personas. Cada
//    una elige su nombre al entrar y sus movimientos quedan firmados. Ver "USUARIOS".
// =====================================================

// El ID de la planilla vive en las propiedades del script y no en este archivo, que está en un
// repositorio público. Se lee una sola vez por ejecución.
// ============ TIEMPOS ============
// Cada respuesta lleva cuánto tardó el servidor ('ms') y en qué ('t': etapa y milisegundos
// acumulados). No cambia nada para quien usa la app; sirve para ver dónde se va el tiempo
// cuando algo tarda, sin adivinar. Se ve en la consola del navegador.
const _T0 = Date.now();
const _marcas = [];
function marca_(nombre) { _marcas.push([nombre, Date.now() - _T0]); }

const PROP_PLANILLA = 'SPREADSHEET_ID';

// Las propiedades del script se leen todas juntas, una vez por ejecución. Cada lectura suelta
// es una llamada a un servicio de Google, y en una carga se consultaban varias veces.
let _props = null;
function prop_(nombre) {
  if (!_props) _props = PropertiesService.getScriptProperties().getProperties() || {};
  return _props[nombre];
}

let _planilla = null;
function planilla_() {
  if (_planilla) return _planilla;
  const id = String(prop_(PROP_PLANILLA) || '').trim();
  if (!id) {
    console.error('Falta la propiedad del script ' + PROP_PLANILLA + ' (Configuración del proyecto > Propiedades del script).');
    throw new Error('La app todavía no está configurada. Avisale a quien la administra.');
  }
  try {
    _planilla = SpreadsheetApp.openById(id);
    marca_('abrir');
  } catch (err) {
    console.error('No se pudo abrir la planilla de la propiedad ' + PROP_PLANILLA + ': ' + err);
    throw new Error('La app no puede abrir sus datos. Avisale a quien la administra.');
  }
  return _planilla;
}

// Para correr a mano desde el editor antes de publicar: confirma que la propiedad está cargada
// y que la planilla abre. No escribe nada.
function probarConfiguracion() {
  const ss = planilla_();
  const msg = 'Configuración correcta. Planilla: "' + ss.getName() + '". ' +
    (!claveRequerida_() ? 'Clave de acceso: SIN activar (cualquiera que tenga la dirección puede entrar).'
       : claveRequerida_().length < 8 ? 'Clave de acceso: activada, pero es corta. Conviene que tenga 8 caracteres o más.'
       : 'Clave de acceso: activada.') + ' ' + resumenUsuarios_();
  console.log(msg);
  return msg;
}

// ============ CLAVE DE ACCESO ============
// La dirección de este Web App es pública (está en el index.html, en un repositorio público) y
// se publica con acceso "Anyone", así que sin esto cualquiera que la tenga puede leer y
// escribir. La clave es un secreto compartido: vive en la propiedad CLAVE_ACCESO del script
// (nunca en el código) y la app la manda en cada lectura y en cada escritura.
//
// Es optativa a propósito: mientras la propiedad no exista, todo funciona abierto como antes.
// Así se puede publicar este código primero y activar la clave después, sin dejar a nadie
// afuera a mitad de camino.
//
// La persona la escribe una sola vez en la app y queda guardada en su teléfono. No distingue
// mayúsculas de minúsculas ni cuenta espacios o guiones, para que escribirla en el celular
// no sea una trampa: "K7M2-QX9P", "k7m2qx9p" y "K7M2 QX9P" son la misma clave.
//
// Para cambiarla (se filtró, o alguien ya no tiene que entrar): cambiar el valor de la
// propiedad, o volver a ejecutar generarClaveAcceso. La anterior deja de servir en el acto,
// para todos, y hay que avisarles la nueva a los que siguen. Para desactivarla: borrar la
// propiedad CLAVE_ACCESO.
const PROP_CLAVE = 'CLAVE_ACCESO';

function normalizarClave_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[\s\-]/g, '');
}

function claveRequerida_() {
  return normalizarClave_(prop_(PROP_CLAVE));
}

/** true si no hay clave configurada o si la recibida coincide. */
function claveOk_(recibida) {
  const c = claveRequerida_();
  return !c || normalizarClave_(recibida) === c;
}

// 'codigo' es lo que mira la app para mostrar la pantalla de clave en vez de un error común.
function respuestaSinClave_(origen) {
  return jsonResponse({ status: 'error', codigo: 'CLAVE', origen: origen,
    message: 'Hace falta la clave de acceso.' });
}

// ============ USUARIOS ============
// Hoja "Usuarios", que carga M a mano: una fila por persona.
//   Nombre | Clave | Activo
// - Nombre: como va a aparecer en la app y en los movimientos.
// - Clave: optativa. Si la persona tiene una, entra con ESA y la clave general no le sirve.
//   Si está vacía, entra con la clave general (propiedad CLAVE_ACCESO).
// - Activo: optativa. "no" (o 0, o una casilla sin tildar) la deja afuera sin borrar la fila.
//
// Mientras la hoja no exista o esté vacía, la app funciona sin nombres, como antes. Apenas
// tiene una persona, TODO pedido al servidor tiene que venir con un nombre de la lista y su
// clave; el nombre validado es el que firma los movimientos (no el que diga la app).
//
// Para sacarle el acceso a alguien: borrar su fila o ponerle "no" en Activo. Si entraba con
// la clave general, además hay que cambiarla, porque la sigue sabiendo y podría entrar
// eligiendo el nombre de otro. Con clave propia por persona eso no pasa.
const SHEET_USUARIOS = 'Usuarios';
const USU_HEADERS = ['Nombre', 'Clave', 'Activo'];

// Quién está haciendo este pedido. Lo deja autenticar_ y lo usa logMovimiento. Las variables
// globales de Apps Script viven lo que dura una ejecución, así que no se cruza entre personas.
let USUARIO_ACTUAL = '';

function normalizarNombre_(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

let _usuariosCache = null;
function usuariosActivos_() {
  if (_usuariosCache) return _usuariosCache;
  const out = [];
  const sheet = planilla_().getSheetByName(SHEET_USUARIOS);
  const data = sheet ? sheet.getDataRange().getValues() : [];
  if (data.length >= 2) {
    const h = data[0].map(function (x) { return String(x).trim().toLowerCase(); });
    let cNom = h.indexOf('nombre'); if (cNom < 0) cNom = 0;
    const cCla = h.indexOf('clave'), cAct = h.indexOf('activo');
    const vistos = {};
    for (let i = 1; i < data.length; i++) {
      const nombre = String(data[i][cNom] == null ? '' : data[i][cNom]).trim();
      if (!nombre) continue;
      if (cAct >= 0) {
        const a = String(data[i][cAct] == null ? '' : data[i][cAct]).trim().toLowerCase();
        if (a === 'no' || a === 'n' || a === '0' || a === 'false') continue;
      }
      const k = normalizarNombre_(nombre);
      if (vistos[k]) continue;          // nombre repetido: vale la primera fila
      vistos[k] = true;
      out.push({ nombre: nombre, clave: cCla >= 0 ? normalizarClave_(data[i][cCla]) : '' });
    }
  }
  _usuariosCache = out;
  marca_('leer Usuarios');
  return out;
}

/**
 * Decide si un pedido puede pasar. Devuelve { ok, usuario } con el nombre tal como está en la
 * hoja. Sin hoja de usuarios vale sólo la clave general, como antes.
 */
function autenticar_(usuario, clave) {
  const lista = usuariosActivos_();
  if (!lista.length) return { ok: claveOk_(clave), usuario: '' };
  const buscado = normalizarNombre_(usuario);
  let u = null;
  for (let i = 0; i < lista.length; i++) {
    if (normalizarNombre_(lista[i].nombre) === buscado) { u = lista[i]; break; }
  }
  if (!buscado || !u) return { ok: false, usuario: '' };
  const esperada = u.clave || claveRequerida_();
  return { ok: !esperada || normalizarClave_(clave) === esperada, usuario: u.nombre };
}

function resumenUsuarios_() {
  const lista = usuariosActivos_();
  if (!lista.length) return 'Usuarios: sin cargar (la app no pide nombre).';
  const general = claveRequerida_();
  const sinClave = lista.filter(function (u) { return !u.clave && !general; }).map(function (u) { return u.nombre; });
  return 'Usuarios: ' + lista.map(function (u) { return u.nombre + (u.clave ? ' (clave propia)' : ''); }).join(', ') + '.' +
    (sinClave.length ? ' OJO: ' + sinClave.join(', ') + ' no tiene clave y no hay clave general: entra cualquiera eligiendo ese nombre.' : '');
}

// Para correr a mano desde el editor, una vez. Crea la hoja Usuarios con sus encabezados.
function crearHojaUsuarios() {
  const ss = planilla_();
  let sheet = ss.getSheetByName(SHEET_USUARIOS);
  let msg;
  if (sheet) {
    msg = 'La hoja Usuarios ya existe. ' + resumenUsuarios_();
  } else {
    sheet = ss.insertSheet(SHEET_USUARIOS);
    sheet.appendRow(USU_HEADERS);
    sheet.getRange(1, 1, 1, USU_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Clave como texto: si no, una clave como 0123 quedaría guardada como el número 123
    sheet.getRange(2, 2, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
    msg = 'Hoja Usuarios creada. Cargá un nombre por fila. Clave y Activo son optativas.';
  }
  console.log(msg);
  return msg;
}

// Para correr a mano desde el editor. Arma una clave al azar corta, pensada para escribirla
// en un celular (sin 0/O ni 1/I/L, que se confunden), la guarda en la propiedad y la muestra
// en el registro de ejecución. Si preferís elegir la tuya, no hace falta correr esto: alcanza
// con escribirla en la propiedad CLAVE_ACCESO.
function generarClaveAcceso() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let clave = '';
  for (let i = 0; i < 8; i++) {
    clave += abc.charAt(parseInt(hex.substr(i * 4, 4), 16) % abc.length);
    if (i === 3) clave += '-';
  }
  PropertiesService.getScriptProperties().setProperty(PROP_CLAVE, clave);
  _props = null;   // lo leído antes ya no vale
  const msg = 'Clave de acceso nueva: ' + clave + '  — Desde ahora la app la pide. Pasásela a ' +
    'cada persona; la escriben una sola vez.';
  console.log(msg);
  return msg;
}

const SHEET_PEDIDOS = 'Pedidos';
const SHEET_STOCK   = 'Stock';        // legacy: ya no se usa. Sólo la mira la migración a Compras, una vez
const SHEET_COMPRAS = 'Compras';      // reemplazo: una fila por compra, con costo
const SHEET_MOVIMIENTOS = 'Movimientos';

// Huso horario de Argentina: todas las fechas del log se guardan en esta zona
const TZ_AR = 'America/Argentina/Buenos_Aires';
const MOV_HEADERS = ['Fecha', 'Tipo', 'Pedido ID', 'Nombre', 'Prenda', 'Talle', 'Monto', 'Medio', 'Detalle', 'Usuario'];
const MOV_COLS_BASE = 9;          // las nueve primeras van por posición, como siempre
const MOV_COL_USUARIO = 'Usuario'; // esta se busca por nombre: en hojas viejas se agrega al final
const COM_HEADERS = ['ID', 'Fecha', 'Tanda', 'Prenda', 'Talle', 'Cantidad', 'Costo Unitario', 'Notas'];

// ============ IDENTIDAD DE UN PEDIDO ============
// Hasta acá un pedido se identificaba por su número de fila. Alcanzaba con borrar o reordenar
// una fila en la planilla para que todas las referencias (retiros, movimientos) apuntaran al
// pedido equivocado, en silencio. Ahora la columna ID es la referencia real y la fila es sólo
// un atajo que se verifica antes de escribir.
const PED_COL_ID = 'ID';

// Un pedido eliminado NO se borra de la planilla: se marca con 1 en esta columna. Borrar la
// fila rompería el historial (los movimientos quedan apuntando a un pedido que no existe) y
// no habría forma de revisar qué se eliminó ni de deshacerlo. La app filtra los anulados al
// cargar, así que para todo lo demás — lista, KPIs, stock, resumen — es como si no estuvieran.
const PED_COL_ANULADO = 'Anulado';

function nuevoIdPedido_() {
  return 'P' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Devuelve el índice 0-based de la columna ID, creándola al final si no existe. */
function colIdPedidos_(sheet) {
  const nCols = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, nCols).getValues()[0].map(h => String(h).trim());
  let ix = headers.indexOf(PED_COL_ID);
  if (ix >= 0) return ix;
  // Se agrega AL FINAL a propósito: insertar en el medio correría todas las columnas y
  // rompería cualquier fórmula o referencia que tengas armada en la planilla.
  sheet.insertColumnAfter(nCols);
  sheet.getRange(1, nCols + 1).setValue(PED_COL_ID).setFontWeight('bold');
  return nCols;
}

/** true si en los valores de la hoja Pedidos hay algún pedido cargado (con Nombre) sin ID. */
function faltanIdsPedidos_(datos) {
  if (!datos || datos.length < 2) return false;
  const headers = datos[0].map(function (h) { return String(h).trim(); });
  const cId = headers.indexOf(PED_COL_ID), cNom = headers.indexOf('Nombre');
  if (cId < 0) return true;                       // ni siquiera está la columna
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][cId] || '').trim()) continue;
    if (cNom >= 0 && !String(datos[i][cNom] || '').trim()) continue;   // fila vacía
    return true;
  }
  return false;
}

/**
 * Completa los IDs que falten. Corre solo desde getAll y corta enseguida si no hay ninguno
 * vacío, así no cuesta nada en el uso normal. Escribe en un solo setValues.
 */
function backfillIdsPedidos_() {
  try {
    const sheet = getOrCreateSheet(SHEET_PEDIDOS);
    const ultima = sheet.getLastRow();
    if (ultima < 2) return null;
    const cId = colIdPedidos_(sheet);

    const ids = sheet.getRange(2, cId + 1, ultima - 1, 1).getValues();
    // Sólo se le pone ID a las filas que tienen algo cargado (columna Nombre)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const cNom = headers.indexOf('Nombre');
    const nombres = cNom >= 0 ? sheet.getRange(2, cNom + 1, ultima - 1, 1).getValues() : null;

    let puestos = 0;
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || '').trim()) continue;
      if (nombres && !String(nombres[i][0] || '').trim()) continue;   // fila vacía
      ids[i][0] = nuevoIdPedido_();
      puestos++;
    }
    if (!puestos) return null;

    sheet.getRange(2, cId + 1, ids.length, 1).setValues(ids);
    logMovimiento({
      tipo: 'SISTEMA', nombre: '', prenda: '', talle: '', monto: 0, medio: '',
      detalle: 'Se asignaron ' + puestos + ' IDs de pedido a filas que no tenían'
    });
    return { puestos: puestos };
  } catch (err) {
    console.error('backfillIdsPedidos_ falló: ' + err);
    return null;
  }
}

/**
 * Resuelve en qué fila está un pedido. Prioriza el ID; `filaHint` (el sheetRow que manda el
 * cliente) se usa sólo como atajo y se verifica. Si no coinciden, se recorre la hoja.
 * Devuelve 0 si no se encuentra — el que llama tiene que abortar, nunca escribir a ciegas.
 */
function filaDePedido_(sheet, id, filaHint) {
  const cId = colIdPedidos_(sheet);
  const ultima = sheet.getLastRow();
  const idBuscado = String(id || '').trim();

  if (idBuscado) {
    const hint = Number(filaHint);
    if (hint > 1 && hint <= ultima) {
      const enHint = String(sheet.getRange(hint, cId + 1).getValue() || '').trim();
      if (enHint === idBuscado) return hint;      // el atajo era correcto
    }
    const ids = sheet.getRange(2, cId + 1, Math.max(0, ultima - 1), 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || '').trim() === idBuscado) return i + 2;
    }
    return 0;   // hay ID pero no está en la hoja: no se escribe nada
  }

  // Sin ID (cliente viejo o pedido anterior al backfill): se cae al número de fila
  const hint = Number(filaHint);
  return (hint > 1 && hint <= ultima) ? hint : 0;
}

/** Lee el ID de una fila de Pedidos (para loguear movimientos con la referencia real). */
function idDeFila_(sheet, fila) {
  const cId = colIdPedidos_(sheet);
  return String(sheet.getRange(fila, cId + 1).getValue() || '').trim();
}

// ============ TEXTO QUE ENTRA DESDE LA APP ============
// Una celda cuyo texto empieza con = + o - es una fórmula para Sheets. Un nombre o una nota
// escritos así (a propósito o sin querer) terminarían ejecutándose en la planilla, o quedando
// como un error en la celda. Se les saca ese arranque antes de escribir. Los números se
// respetan tal cual, incluidos los negativos.
function textoSeguro_(v) {
  if (typeof v !== 'string') return v;
  if (!/^\s*[=+\-]/.test(v)) return v;
  if (v.trim() !== '' && !isNaN(Number(v))) return v;
  return v.replace(/^[\s=+\-]+/, '');
}

/** Aplica textoSeguro_ a todo lo que viene en el cuerpo de un POST, claves incluidas. */
function entradaSegura_(x) {
  if (typeof x === 'string') return textoSeguro_(x);
  if (Array.isArray(x)) return x.map(entradaSegura_);
  if (x && typeof x === 'object') {
    const out = {};
    Object.keys(x).forEach(function (k) { out[textoSeguro_(k)] = entradaSegura_(x[k]); });
    return out;
  }
  return x;
}

// ============ HELPERS ============

// ============ HOJA EN MEMORIA ============
// Lo caro de Apps Script no es la cantidad de filas: es cada ida a la planilla, y sobre todo
// LEER después de haber ESCRITO, porque obliga a Sheets a aplicar lo pendiente y recalcular
// antes de contestar. Un guardado hacía una veintena de idas, con lecturas intercaladas entre
// las escrituras.
//
// Esto envuelve una hoja para que se lea UNA sola vez, entera, y a partir de ahí todas las
// consultas (valores, última fila, última columna) se contesten desde esa copia. Las
// escrituras van a la planilla en el momento y además actualizan la copia, así que lo que se
// lee después coincide con lo recién escrito sin volver a preguntar. Resultado: una lectura,
// las escrituras, y una sola aplicación al final.
//
// Tiene los mismos métodos que una hoja de verdad (los que usa este archivo), para que el
// resto del código no cambie. Sólo se escriben las celdas que se tocan: nunca filas enteras,
// que pisarían fórmulas o formatos que haya en otras columnas.
function HojaMem_(sheet, nombre) { this.s = sheet; this.nombre = nombre; this.d = null; }
HojaMem_.prototype._datos = function () {
  if (!this.d) {
    const v = this.s.getDataRange().getValues();
    // Una hoja vacía devuelve una sola celda vacía: se la trata como cero filas
    this.d = (v.length === 1 && v[0].length === 1 && v[0][0] === '') ? [] : v;
    marca_('leer ' + this.nombre);
  }
  return this.d;
};
HojaMem_.prototype._asegurar = function (filas, cols) {
  const d = this._datos();
  const ancho = Math.max(cols, d.length ? d[0].length : 0);
  while (d.length < filas) d.push([]);
  for (let i = 0; i < d.length; i++) while (d[i].length < ancho) d[i].push('');
};
HojaMem_.prototype.getLastRow    = function () { return this._datos().length; };
HojaMem_.prototype.getLastColumn = function () { const d = this._datos(); return d.length ? d[0].length : 0; };
HojaMem_.prototype.getMaxRows    = function () { return this.s.getMaxRows(); };
HojaMem_.prototype.getDataRange  = function () {
  return new RangoMem_(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
};
HojaMem_.prototype.getRange = function (r, c, nr, nc) { return new RangoMem_(this, r, c, nr || 1, nc || 1); };
HojaMem_.prototype.appendRow = function (fila) {
  const d = this._datos();              // se lee antes de escribir, nunca después
  this.s.appendRow(fila);
  const nueva = fila.slice();
  d.push(nueva);
  this._asegurar(d.length, nueva.length);
  return this;
};
HojaMem_.prototype.insertColumnAfter = function (n) {
  const d = this._datos();
  this.s.insertColumnAfter(n);
  // En la copia sólo hace falta correr lo que quede a la derecha; agregar al final no cambia nada
  for (let i = 0; i < d.length; i++) if (d[i].length > n) d[i].splice(n, 0, '');
  return this;
};
HojaMem_.prototype.setFrozenRows = function (n) { this.s.setFrozenRows(n); return this; };

function RangoMem_(hoja, r, c, nr, nc) { this.h = hoja; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
RangoMem_.prototype._real = function () { return this.h.s.getRange(this.r, this.c, this.nr, this.nc); };
RangoMem_.prototype.getValues = function () {
  const d = this.h._datos(), out = [];
  for (let i = 0; i < this.nr; i++) {
    const fila = d[this.r - 1 + i] || [], o = [];
    for (let j = 0; j < this.nc; j++) { const v = fila[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
    out.push(o);
  }
  return out;
};
RangoMem_.prototype.getValue = function () { return this.getValues()[0][0]; };
RangoMem_.prototype.setValue = function (v) {
  this.h._asegurar(this.r, this.c);
  this._real().setValue(v);
  this.h.d[this.r - 1][this.c - 1] = v;
  return this;
};
RangoMem_.prototype.setValues = function (vs) {
  this.h._asegurar(this.r + this.nr - 1, this.c + this.nc - 1);
  this._real().setValues(vs);
  for (let i = 0; i < vs.length; i++) for (let j = 0; j < vs[i].length; j++) this.h.d[this.r - 1 + i][this.c - 1 + j] = vs[i][j];
  return this;
};
RangoMem_.prototype.setFontWeight   = function (x) { this._real().setFontWeight(x);   return this; };
RangoMem_.prototype.setNumberFormat = function (x) { this._real().setNumberFormat(x); return this; };

// Una hoja en memoria por nombre y por ejecución. Movimientos queda afuera a propósito: puede
// tener miles de filas y de ella sólo se lee el final (ver leerMovimientos) o se le agrega una.
const _hojas = {};
function getOrCreateSheet(name, headers) {
  if (_hojas[name]) return _hojas[name];
  const ss = planilla_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  if (name === SHEET_MOVIMIENTOS) return sheet;
  _hojas[name] = new HojaMem_(sheet, name);
  return _hojas[name];
}

function sheetToObjects(sheet) {
  return objetosDeValores_(sheet.getDataRange().getValues());
}

/** Convierte los valores ya leídos de una hoja (con su fila de encabezados) en objetos. */
function objetosDeValores_(data) {
  if (data.length < 2) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const val = data[i][j];
      // Si Sheets interpretó la celda como fecha, la devolvemos formateada en
      // hora de Argentina. Sin esto, JSON.stringify la manda en UTC y el día
      // se corre para los movimientos de la noche.
      obj[headers[j]] = (val instanceof Date)
        ? Utilities.formatDate(val, TZ_AR, 'yyyy-MM-dd HH:mm:ss')
        : val;
    }
    obj._row = i + 1; // 1-indexed row number in sheet
    rows.push(obj);
  }
  return rows;
}

// ============ MOVIMIENTOS: log de actividad ============

// Fecha/hora actual en huso horario de Argentina, formato 'yyyy-MM-dd HH:mm:ss'
function ahoraAR() {
  return Utilities.formatDate(new Date(), TZ_AR, 'yyyy-MM-dd HH:mm:ss');
}

// Importe como se lee en la app ('$35.000'). Se arma a mano en vez de usar toLocaleString para
// no depender de qué configuración regional tenga el proyecto de Apps Script.
function plata_(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Normaliza el valor de la celda Fecha a string 'yyyy-MM-dd HH:mm:ss' en hora AR.
// Contempla que Sheets pueda devolver un Date en vez del string guardado.
function fechaMovToStr(val) {
  if (val instanceof Date) return Utilities.formatDate(val, TZ_AR, 'yyyy-MM-dd HH:mm:ss');
  return String(val || '').trim();
}

// Registra un movimiento. Nunca debe romper la operación principal.
// m: { tipo, pedidoId, nombre, prenda, talle, monto, medio, detalle }
// Índice (0-based) de la columna Usuario en Movimientos, o -1 si no está. Con `crear`, la agrega
// al final cuando falta: las hojas que ya existían tienen sólo las nueve columnas originales.
function colUsuarioMov_(sheet, crear) {
  const n = sheet.getLastColumn();
  let headers = n ? sheet.getRange(1, 1, 1, n).getValues()[0] : [];
  let ix = headers.map(function (h) { return String(h).trim(); }).indexOf(MOV_COL_USUARIO);
  if (ix < 0 && crear) {
    headers = asegurarColumna_(sheet, headers, MOV_COL_USUARIO);
    ix = headers.map(function (h) { return String(h).trim(); }).indexOf(MOV_COL_USUARIO);
  }
  return ix;
}

// En qué columna de Movimientos va el nombre de quien hizo el movimiento. Se recuerda en una
// propiedad del script para no tener que LEER el encabezado en cada guardado: esa lectura,
// hecha después de escribir el pedido, obligaba a la planilla a aplicar y recalcular a mitad
// de camino. Las propiedades ya vienen leídas (prop_), así que consultarla no cuesta nada.
// Se corrige sola: cada vez que la app pide los movimientos se compara con el encabezado real.
const PROP_MOV_USUARIO = 'MOV_COL_USUARIO';
function recordarColUsuarioMov_(ix) {
  try {
    if (String(prop_(PROP_MOV_USUARIO)) === String(ix)) return;
    const ps = PropertiesService.getScriptProperties();
    if (ix >= 0) ps.setProperty(PROP_MOV_USUARIO, String(ix)); else ps.deleteProperty(PROP_MOV_USUARIO);
    if (_props) { if (ix >= 0) _props[PROP_MOV_USUARIO] = String(ix); else delete _props[PROP_MOV_USUARIO]; }
  } catch (err) {
    console.error('No se pudo recordar la columna Usuario: ' + err);
  }
}

// La hoja Movimientos se pide una vez por ejecución, y en un guardado se pide ANTES de empezar
// a escribir (ver doPost_): así agregar el movimiento al final no necesita consultar nada.
let _hojaMov;
function hojaMov_() {
  if (_hojaMov === undefined) _hojaMov = planilla_().getSheetByName(SHEET_MOVIMIENTOS) || null;
  return _hojaMov;
}

function logMovimiento(m) {
  try {
    let sheet = hojaMov_();
    let cUsu;
    if (!sheet) {
      sheet = getOrCreateSheet(SHEET_MOVIMIENTOS, MOV_HEADERS);   // la crea con sus encabezados
      _hojaMov = sheet;
      cUsu = MOV_HEADERS.indexOf(MOV_COL_USUARIO);
      recordarColUsuarioMov_(cUsu);
    } else {
      const recordada = prop_(PROP_MOV_USUARIO);
      cUsu = (recordada === undefined || recordada === null || recordada === '') ? -1 : Number(recordada);
      if (!(cUsu >= 0)) {
        // Primera vez (o se perdió el dato): se mira el encabezado, creando la columna si falta
        cUsu = colUsuarioMov_(sheet, true);
        recordarColUsuarioMov_(cUsu);
      }
    }
    // textoSeguro_ también acá: nombre y talle a veces se releen de la planilla (donde un
    // texto viejo puede empezar con =) y volver a escribirlos tal cual los haría fórmula.
    const fila = [
      ahoraAR(),
      m.tipo     || '',
      m.pedidoId || '',
      textoSeguro_(String(m.nombre  || '')),
      textoSeguro_(String(m.prenda  || '')),
      textoSeguro_(String(m.talle   || '')),
      Number(m.monto) || 0,
      m.medio    || '',
      textoSeguro_(String(m.detalle || ''))
    ];
    // Quién lo hizo: el nombre que validó el servidor para este pedido, no uno que mande la app
    if (cUsu >= 0) {
      while (fila.length <= cUsu) fila.push('');
      fila[cUsu] = textoSeguro_(String(USUARIO_ACTUAL || ''));
    }
    sheet.appendRow(fila);
  } catch (err) {
    // Silencioso a propósito: si falla el log, el pedido/pago/retiro igual se guarda
    console.error('logMovimiento falló: ' + err);
  }
}

// Lee movimientos filtrando por rango de fechas, de más reciente a más antiguo.
// desde / hasta: 'yyyy-MM-dd' (inclusive ambos). limit: máximo de filas a devolver.
// Recorre la hoja de abajo hacia arriba en bloques y corta apenas pasa el 'desde',
// así no carga toda la hoja cuando el historial crece.
function leerMovimientos(desde, hasta, limit) {
  const sheet = hojaMov_();
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const max = Number(limit) > 0 ? Number(limit) : 500;
  const desdeD = desde ? String(desde).slice(0, 10) : '';
  const hastaD = hasta ? String(hasta).slice(0, 10) : '';

  const cUsuMov  = colUsuarioMov_(sheet, false);
  const nColsMov = Math.max(MOV_COLS_BASE, cUsuMov + 1);
  recordarColUsuarioMov_(cUsuMov);   // mantiene al día lo que usa logMovimiento

  const CHUNK = 500;   // igual al tope que pide la app: el caso normal sale en una sola lectura
  const out = [];
  let end = lastRow;
  let cortar = false;

  while (end >= 2 && out.length < max && !cortar) {
    const start = Math.max(2, end - CHUNK + 1);
    const values = sheet.getRange(start, 1, end - start + 1, nColsMov).getValues();

    for (let i = values.length - 1; i >= 0; i--) {
      const fecha = fechaMovToStr(values[i][0]);
      if (!fecha) continue;
      const dia = fecha.slice(0, 10);

      if (desdeD && dia < desdeD) { cortar = true; break; }
      if (hastaD && dia > hastaD) continue;

      out.push({
        fecha:    fecha,
        tipo:     String(values[i][1] || ''),
        pedidoId: String(values[i][2] || ''),
        nombre:   String(values[i][3] || ''),
        prenda:   String(values[i][4] || ''),
        talle:    String(values[i][5] || ''),
        monto:    Number(values[i][6]) || 0,
        medio:    String(values[i][7] || ''),
        detalle:  String(values[i][8] || ''),
        usuario:  cUsuMov >= 0 ? String(values[i][cUsuMov] || '') : ''
      });

      if (out.length >= max) break;
    }
    end = start - 1;
  }

  return out;
}

// ============ GET: Read all data ============

function doGet(e) { return emitir_(doGet_(e)); }

function doGet_(e) {
  try {
    const action = e.parameter.action;

    // Sin clave no se lee nada. Va con origen 'doGet' igual que el resto de este método: un
    // POST cuyo salto de redirección se perdió también cae acá (sin parámetros), y la app
    // tiene que seguir reconociéndolo como tal y no como un rechazo de la clave.
    // La lista de nombres para la pantalla de ingreso se entrega sin clave: hace falta antes
    // de poder entrar. Sólo nombres, y si a esa persona le corresponde escribir una clave.
    if (action === 'usuarios') {
      const general = claveRequerida_();
      return jsonResponse({ status: 'ok', pideClave: !!general,
        usuarios: usuariosActivos_().map(function (u) {
          return { nombre: u.nombre, pideClave: !!(u.clave || general) };
        }) });
    }

    if (!autenticar_(e.parameter.usuario, e.parameter.clave).ok) return respuestaSinClave_('doGet');
    marca_('acceso');

    // La pantalla de clave de la app pregunta acá si la clave que se pegó es la buena, sin
    // traer ningún dato.
    if (action === 'probarClave') {
      return jsonResponse({ status: 'ok' });
    }

    // Qué pasó con un guardado (ver "CADA GUARDADO, UNA SOLA VEZ")
    if (action === 'resultado') {
      const opId = opIdValido_(e.parameter.opId);
      const r = opId ? leerResultadoOp_(opId) : null;
      return jsonResponse({ status: 'ok', encontrado: !!r, respuesta: r });
    }

    if (action === 'getPedidos') {
      return getPedidos();
    }
    if (action === 'getMovimientos') {
      return jsonResponse({
        status: 'ok',
        movimientos: leerMovimientos(e.parameter.desde, e.parameter.hasta, e.parameter.limitMov)
      });
    }
    if (action === 'getAll') {
      return getAll(e.parameter.desde, e.parameter.hasta, e.parameter.limitMov, e.parameter.mov !== '0');
    }

    // 'origen' le dice al cliente que esta respuesta salió de doGet. Un POST que termina acá
    // es un POST cuyo salto de redirección se perdió, no una acción inexistente: el cliente
    // lo usa para no dar por fallida una escritura que el servidor sí ejecutó.
    return jsonResponse({ status: 'error', origen: 'doGet',
      message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', origen: 'doGet', message: (err && err.message) || String(err) });
  }
}

// conMov === false: la app está en una pantalla que no muestra movimientos, así que no se leen.
// Devuelve movimientos: null, que la app entiende como "quedate con los que tenías".
function getAll(desde, hasta, limitMov, conMov) {
  const pedidosSheet = getOrCreateSheet(SHEET_PEDIDOS);

  // Las hojas Retiros y Stock ya no se leen: la app no usa ninguna de las dos (el retiro vive
  // en las columnas del pedido y el stock sale de Compras), y leerlas en cada carga era tiempo
  // perdido. Tampoco se crean si faltan. Lo único que todavía mira Stock es la migración de
  // abajo, y sólo si Compras está vacía.

  // Pedidos se lee UNA vez. Antes, completar los IDs faltantes leía la hoja por partes (cuatro
  // lecturas) en cada carga aunque no faltara ninguno, y después se volvía a leer entera. Ahora
  // se mira en lo ya leído si falta alguno, y sólo en ese caso se completan y se relee.
  let datos = pedidosSheet.getDataRange().getValues();
  let backfill = null;
  if (faltanIdsPedidos_(datos)) {
    // Con el lock tomado y releyendo: si dos cargas llegan juntas, que no le pongan cada una
    // un ID distinto a la misma fila. Si no se consigue el turno, se deja para la próxima.
    const lock = LockService.getScriptLock();
    let tengo = false;
    try { lock.waitLock(10000); tengo = true; } catch (err) { tengo = false; }
    try {
      if (tengo) {
        pedidosSheet.d = null;
        datos = pedidosSheet.getDataRange().getValues();
        if (faltanIdsPedidos_(datos)) {
          backfill = backfillIdsPedidos_();
          datos = pedidosSheet.getDataRange().getValues();
          try { SpreadsheetApp.flush(); } catch (err) {}
        }
      }
    } finally {
      if (tengo) lock.releaseLock();
    }
  }
  const pedidos = objetosDeValores_(datos);

  // La migración desde la hoja Stock sólo tiene sentido con Compras vacía: se pregunta eso con
  // lo que ya se leyó, en vez de consultar la hoja aparte en cada carga.
  let compras = getCompras();
  let migracion = null;
  if (!compras.length) {
    migracion = migrarStockACompras_();
    if (migracion) compras = getCompras();
  }
  const movimientos = conMov === false ? null : leerMovimientos(desde, hasta, limitMov);
  if (conMov !== false) marca_('leer Movimientos');

  return jsonResponse({ status: 'ok', pedidos, compras, movimientos,
                        migracion: migracion, backfill: backfill,
                        hoyAR: ahoraAR().slice(0, 10) });
}

// ============ COMPRAS ============
// El stock pasó de ser dos fotos ("stock inicial" de 1ra y de 2da tanda) a un registro de
// compras: una fila por prenda+talle+tanda, con su costo. Así una tanda nueva es una fila más
// en vez de una grilla más en el código, y aparece el dato de costo para calcular la ganancia.

function getCompras() {
  const sheet = getOrCreateSheet(SHEET_COMPRAS, COM_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const h = data[0].map(x => String(x).trim());
  const ix = n => h.indexOf(n);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[ix('Prenda')] && !r[ix('Talle')]) continue;
    out.push({
      id:     String(r[ix('ID')] || ''),
      fecha:  fechaMovToStr(r[ix('Fecha')]).slice(0, 10),
      tanda:  String(r[ix('Tanda')]  || '').toUpperCase(),
      prenda: String(r[ix('Prenda')] || '').toUpperCase(),
      talle:  String(r[ix('Talle')]  || '').toUpperCase(),
      cant:   Number(r[ix('Cantidad')]) || 0,
      costo:  Number(r[ix('Costo Unitario')]) || 0,
      notas:  String(r[ix('Notas')] || ''),
      _row:   i + 1
    });
  }
  return out;
}

function idCompra_() {
  return 'C' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Migración de una sola vez: pasa la hoja Stock a Compras con costo 0 (M los carga después).
// Sólo corre si Compras está vacía y Stock tiene algo, así que es idempotente y no se puede
// duplicar sola. Se devuelve el resumen para que la app pueda avisarlo en pantalla.
function migrarStockACompras_() {
  try {
    const compras = getOrCreateSheet(SHEET_COMPRAS, COM_HEADERS);
    if (compras.getLastRow() > 1) return null;         // ya hay compras: nada que hacer

    const ss = planilla_();
    const stock = ss.getSheetByName(SHEET_STOCK);
    if (!stock) return null;
    const data = stock.getDataRange().getValues();
    if (data.length < 2) return null;

    const hoy = ahoraAR().slice(0, 10);
    const filas = [];
    for (let i = 1; i < data.length; i++) {
      const tipoRaw = String(data[i][0] || '').trim().toUpperCase();
      const talle   = String(data[i][1] || '').trim().toUpperCase();
      const cant    = Number(data[i][2]) || 0;
      if (!tipoRaw || !talle || cant <= 0) continue;
      // El sufijo _2DA era la única marca de que una fila pertenecía a la segunda tanda
      const esSegunda = tipoRaw.endsWith('_2DA');
      filas.push([idCompra_(), hoy, esSegunda ? 'SEGUNDA' : 'PRIMERA',
                  tipoRaw.replace('_2DA', ''), talle, cant, 0,
                  'Migrado de la hoja Stock — falta cargar el costo']);
    }
    if (!filas.length) return null;
    compras.getRange(compras.getLastRow() + 1, 1, filas.length, COM_HEADERS.length).setValues(filas);

    const unidades = filas.reduce((s, f) => s + f[5], 0);
    logMovimiento({
      tipo: 'COMPRA', nombre: '', prenda: '', talle: '', monto: 0, medio: '',
      detalle: 'Migración: ' + filas.length + ' filas de la hoja Stock pasadas a Compras (' +
               unidades + ' unidades, costo pendiente de cargar)'
    });
    return { filas: filas.length, unidades: unidades };
  } catch (err) {
    console.error('migrarStockACompras_ falló: ' + err);
    return null;
  }
}

// Registra una compra: una fila por talle. Acepta prenda y tanda nuevas (llegan como texto).
function guardarCompra(data) {
  const sheet = getOrCreateSheet(SHEET_COMPRAS, COM_HEADERS);
  const prenda = String(data.prenda || '').trim().toUpperCase();
  const tanda  = String(data.tanda  || '').trim().toUpperCase();
  const costo  = Number(data.costo) || 0;
  const det    = data.detalle || {};
  if (!prenda) return jsonResponse({ status: 'error', message: 'Falta la prenda.' });
  if (!tanda)  return jsonResponse({ status: 'error', message: 'Falta la tanda.' });

  const fecha = String(data.fecha || '').slice(0, 10) || ahoraAR().slice(0, 10);
  const filas = [];
  Object.keys(det).forEach(t => {
    const cant = Number(det[t]) || 0;
    if (cant > 0) filas.push([idCompra_(), fecha, tanda, prenda,
                              String(t).toUpperCase(), cant, costo, data.notas || '']);
  });
  if (!filas.length) return jsonResponse({ status: 'error', message: 'Ningún talle con cantidad.' });

  sheet.getRange(sheet.getLastRow() + 1, 1, filas.length, COM_HEADERS.length).setValues(filas);

  const unidades = filas.reduce((s, f) => s + f[5], 0);
  const resumen  = filas.map(f => f[4] + ' ' + f[5]).join(', ');
  logMovimiento({
    tipo: 'COMPRA', nombre: '', prenda: data.prendaLabel || prenda, talle: '',
    monto: unidades * costo, medio: '',
    detalle: tanda + ' · ' + resumen + ' · ' + unidades + ' unid. a ' + costo + ' c/u'
  });
  return jsonResponse({ status: 'ok', message: 'Compra registrada', unidades: unidades });
}

// Corrige el costo unitario de una fila de compra (las migradas entran con 0).
function actualizarCostoCompra(data) {
  const sheet = getOrCreateSheet(SHEET_COMPRAS, COM_HEADERS);
  const all = sheet.getDataRange().getValues();
  const h = all[0].map(x => String(x).trim());
  const cId = h.indexOf('ID'), cCosto = h.indexOf('Costo Unitario');
  if (cId < 0 || cCosto < 0) return jsonResponse({ status: 'error', message: 'Faltan columnas en Compras.' });
  const nuevo = Number(data.costo) || 0;
  if (nuevo < 0) return jsonResponse({ status: 'error', message: 'El costo no puede ser negativo.' });

  for (let i = 1; i < all.length; i++) {
    if (String(all[i][cId]) === String(data.id)) {
      const viejo = Number(all[i][cCosto]) || 0;
      if (viejo === nuevo) return jsonResponse({ status: 'ok', message: 'Sin cambios' });
      sheet.getRange(i + 1, cCosto + 1).setValue(nuevo);
      logMovimiento({
        tipo: 'COMPRA', nombre: '', prenda: String(all[i][h.indexOf('Prenda')] || ''),
        talle: String(all[i][h.indexOf('Talle')] || ''), monto: 0, medio: '',
        detalle: 'costo unitario: ' + viejo + ' → ' + nuevo
      });
      return jsonResponse({ status: 'ok', message: 'Costo actualizado' });
    }
  }
  return jsonResponse({ status: 'error', message: 'No se encontró la compra ' + data.id });
}

function getPedidos() {
  const sheet = getOrCreateSheet(SHEET_PEDIDOS);
  const pedidos = sheetToObjects(sheet);
  return jsonResponse({ status: 'ok', pedidos });
}

// ============ POST: Write data ============

// Serializa TODAS las escrituras. Sin esto, dos personas usando la app al mismo tiempo pueden
// leer los mismos índices de fila antes de escribir: la segunda termina operando sobre una fila
// que ya no es la que creía, y pisa el pedido equivocado. Con multiusuario no es hipotético.
// Las lecturas (doGet) NO toman el lock, para que un getAll largo no trabe un guardado.
// ============ CADA GUARDADO, UNA SOLA VEZ ============
// La respuesta de Apps Script viaja por un salto de redirección que Google a veces pierde o
// demora muchísimo (devuelve una página 404, o tarda 20–30 segundos) aunque el guardado ya se
// haya hecho en uno o dos. Desde la app eso se veía como "falló" o como una espera eterna, y
// repetirlo cobraba dos veces.
//
// Por eso cada guardado viene con un número de operación (opId) que genera la app:
//  - al terminar, la respuesta se guarda unos minutos bajo ese número;
//  - si llega otra vez el mismo número, NO se vuelve a ejecutar: se devuelve lo guardado;
//  - la app puede preguntar por GET (action=resultado) qué pasó con un número, que es una
//    consulta que sí se puede repetir sin riesgo.
// Así la app puede confirmar un guardado sin depender de que llegue la respuesta original, y
// reintentar sin miedo a duplicar.
const OP_MINUTOS = 15;
function opIdValido_(v) {
  const s = String(v == null ? '' : v);
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : '';
}
function leerResultadoOp_(opId) {
  try {
    const txt = CacheService.getScriptCache().get('op_' + opId);
    return txt ? JSON.parse(txt) : null;
  } catch (err) {
    console.error('leerResultadoOp_ falló: ' + err);
    return null;
  }
}
function guardarResultadoOp_(opId, obj) {
  try {
    CacheService.getScriptCache().put('op_' + opId, JSON.stringify(obj), OP_MINUTOS * 60);
  } catch (err) {
    console.error('guardarResultadoOp_ falló: ' + err);
  }
}

function doPost(e) { return emitir_(doPost_(e)); }

function doPost_(e) {
  // La clave se revisa ANTES de tomar el lock: un pedido sin clave no tiene que poder hacer
  // esperar a los guardados de verdad. Se lee del cuerpo tal cual llegó. El 'ping' pasa
  // siempre: no toca datos y la app lo necesita para saber si puede leer las respuestas.
  let cruda = null;
  try { cruda = JSON.parse(e.postData.contents); } catch (err) { cruda = null; }
  if (cruda && cruda.action !== 'ping') {
    let acceso;
    try {
      acceso = autenticar_(cruda.usuario, cruda.clave);
    } catch (err) {
      return jsonResponse({ status: 'error', origen: 'doPost', message: (err && err.message) || String(err) });
    }
    if (!acceso.ok) return respuestaSinClave_('doPost');
    USUARIO_ACTUAL = acceso.usuario;   // firma los movimientos de esta ejecución
    marca_('acceso');
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return jsonResponse({ status: 'error',
      message: 'El servidor está ocupado con otra operación. Probá de nuevo en unos segundos.' });
  }
  marca_('turno');
  const opId = (cruda && cruda.action !== 'ping') ? opIdValido_(cruda.opId) : '';
  let hecho = null;
  try {
    // ¿Ya se hizo esta misma operación? Se mira con el lock tomado: si el envío anterior
    // todavía se estaba ejecutando, recién acá terminó y su resultado ya está guardado.
    if (opId) {
      const previa = leerResultadoOp_(opId);
      if (previa) { previa.repetido = true; marca_('repetido'); return jsonResponse(previa); }
    }
    if (cruda && cruda.action !== 'ping') hojaMov_();
    const salida = rutearPost_(e);
    marca_('accion');
    hecho = salida;
    return salida;
  } finally {
    // Lo escrito se aplica ANTES de soltar el lock. Si no, el siguiente guardado podía empezar
    // a leer la planilla cuando lo de éste todavía no estaba aplicado. Además deja medido
    // cuánto tarda la planilla en aplicar y recalcular, que es parte de la espera.
    try { SpreadsheetApp.flush(); } catch (err) { console.error('flush falló: ' + err); }
    marca_('aplicar');
    // El resultado queda anotado antes de soltar el lock, ya con lo escrito aplicado
    if (opId && hecho && hecho.__json) guardarResultadoOp_(opId, hecho.__json);
    lock.releaseLock();
  }
}

function rutearPost_(e) {
  try {
    const cruda = JSON.parse(e.postData.contents);
    const data = entradaSegura_(cruda);
    const action = data.action;

    // Nunca contestar 'Unknown action: undefined' desde acá: ese texto exacto es la firma de
    // doGet y el cliente lo usa para detectar que se perdió la redirección del POST. Si
    // llegara un cuerpo sin action, el mensaje tiene que ser distinguible.
    if (!action) {
      return jsonResponse({ status: 'error', origen: 'doPost',
        message: 'El POST llegó sin action. Cuerpo: ' + String(e.postData.contents).slice(0, 150) });
    }

    // Sirve para que la app pruebe si el navegador puede leer las respuestas de un POST
    if (action === 'ping') {
      return jsonResponse({ status: 'ok', pong: true, hoyAR: ahoraAR(),
                            claveOk: autenticar_(cruda && cruda.usuario, cruda && cruda.clave).ok });
    }
    if (action === 'nuevoPedido') {
      return nuevoPedido(data);
    }
    if (action === 'registrarRetiro') {
      return registrarRetiro(data);
    }
    if (action === 'updateRetiro') {
      return updateRetiro(data);
    }
    if (action === 'registrarSeña') {
      return registrarSeña(data);
    }
    if (action === 'editarPedido') {
      return editarPedido(data);
    }
    if (action === 'editarRetiro') {
      return editarRetiro(data);
    }
    if (action === 'eliminarPedido') {
      return eliminarPedido(data);
    }
    if (action === 'guardarCompra') {
      return guardarCompra(data);
    }
    if (action === 'actualizarCostoCompra') {
      return actualizarCostoCompra(data);
    }

    return jsonResponse({ status: 'error', origen: 'doPost',
      message: 'Acción desconocida: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', origen: 'doPost', message: (err && err.message) || String(err) });
  }
}

// --- Nuevo pedido: agrega fila a hoja Pedidos ---
// Acepta 'tipoKey' (ej: 'ARQUERO_CELESTE') y crea la columna en la hoja si no existe.
// Agrega una columna al final de la hoja si todavía no existe. Devuelve los headers
// actualizados. Se usa para las columnas de retiro, que en hojas viejas pueden faltar.
function asegurarColumna_(sheet, headers, nombre) {
  if (headers.map(h => h.toString().trim().toUpperCase()).includes(nombre.toUpperCase())) return headers;
  const lastCol = sheet.getLastColumn();
  sheet.insertColumnAfter(lastCol);
  sheet.getRange(1, lastCol + 1).setValue(nombre).setFontWeight('bold');
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function nuevoPedido(data) {
  // Validar que la seña no supere el total
  const seña  = Number(data.seña)  || 0;
  const total = Number(data.total) || 0;
  if (total > 0 && seña > total) {
    return jsonResponse({ status: 'error', message: `La seña (${seña}) no puede superar el total (${total})` });
  }

  // Alta + retiro en un solo paso (el cliente manda retirado:1 desde el formulario).
  // Si se lo lleva en el acto nunca hubo seña: el monto del formulario es el pago hecho al
  // retirar. Va a 'Monto Retiro' y además suma a 'Seña', que es la columna que acumula todo
  // lo pagado — mismo criterio que usa registrarRetiro().
  const retiraAhora = Number(data.retirado) === 1;
  const pagoRetiro  = retiraAhora ? seña : 0;
  const medioRetiro = String(data.modoPago || '').toLowerCase();

  const sheet = getOrCreateSheet(SHEET_PEDIDOS);
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const tipoKey = (data.tipoKey || '').toString().trim().toUpperCase();

  // Auto-agregar columna si el tipo no existe aún en la hoja
  if (tipoKey && !headers.map(h => h.toString().trim().toUpperCase()).includes(tipoKey)) {
    const knownTipoCols = ['BLANCA', 'AZUL', 'SHORT', 'CHOMBA', 'ARQUERO_CELESTE', 'ARQUERO_NEGRA'];
    let insertAfterCol = 0;
    headers.forEach((h, idx) => {
      if (knownTipoCols.includes(h.toString().trim().toUpperCase())) insertAfterCol = idx + 1;
    });
    if (insertAfterCol === 0) insertAfterCol = 1;
    sheet.insertColumnAfter(insertAfterCol);
    const newColIdx = insertAfterCol + 1;
    sheet.getRange(1, newColIdx).setValue(tipoKey).setFontWeight('bold');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // Auto-agregar columna Regalo si no existe aún
  if (!headers.map(h => h.toString().trim().toUpperCase()).includes('REGALO')) {
    sheet.appendColumn ? null : null; // no hay appendColumn, usar insertColumn al final
    const lastCol = sheet.getLastColumn();
    sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, lastCol + 1).setValue('Regalo').setFontWeight('bold');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // Auto-agregar columna Fecha Alta si no existe aún.
  // Se fuerza formato texto para que Sheets no reinterprete la fecha en otra zona horaria.
  if (!headers.map(h => h.toString().trim().toUpperCase()).includes('FECHA ALTA')) {
    const lastCol = sheet.getLastColumn();
    sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, lastCol + 1).setValue('Fecha Alta').setFontWeight('bold');
    sheet.getRange(2, lastCol + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // Columnas de retiro: sólo se crean si hacen falta, para no ensanchar hojas que nunca
  // usaron el alta con retiro.
  if (retiraAhora) {
    ['Talle Retiro', 'Medio de Pago Retiro', 'Monto Retiro', 'Notas Retiro'].forEach(c => {
      headers = asegurarColumna_(sheet, headers, c);
    });
  }

  // Conjunto de columnas de tipo (flags binarios)
  const tipoCols = new Set(['BLANCA', 'AZUL', 'SHORT', 'CHOMBA', 'ARQUERO_CELESTE', 'ARQUERO_NEGRA']);
  if (tipoKey) tipoCols.add(tipoKey);

  // Build row matching existing headers
  const row = headers.map(h => {
    const key = h.toString().trim();
    if (tipoCols.has(key)) return key === tipoKey ? 1 : 0;
    if (key === 'Nombre') return data.nombre || '';
    if (key === 'Talle') return data.talle || '';
    if (key === 'Seña') return Number(data.seña) || 0;
    if (key === 'Total') return Number(data.total) || 0;
    if (key === 'Resta') return (Number(data.total) || 0) - (Number(data.seña) || 0);
    if (key === 'Notas') return data.notas || '';
    if (key === 'Total Transferencia') return data.modoPago === 'Transferencia' ? (Number(data.seña) || 0) : 0;
    if (key === 'Total Efectivo') return data.modoPago === 'Efectivo' ? (Number(data.seña) || 0) : 0;
    if (key === 'Tanda') return data.tanda || 'SEGUNDA';
    if (key === 'Retirado') return retiraAhora ? 1 : 0;
    if (key === 'Talle Retiro')         return retiraAhora ? (data.talle    || '') : '';
    if (key === 'Medio de Pago Retiro') return retiraAhora ? medioRetiro          : '';
    if (key === 'Monto Retiro')         return retiraAhora ? pagoRetiro           : '';
    if (key === 'Notas Retiro')         return retiraAhora ? (data.notas    || '') : '';
    if (key === 'Regalo') return Number(data.regalo) || 0;
    if (key === 'Fecha Alta') return ahoraAR();
    if (key === PED_COL_ID) return '';   // se completa abajo, con la columna ya asegurada
    return '';
  });

  // El ID se genera acá y se devuelve al cliente, así el pedido recién creado se puede editar
  // o retirar en el acto sin esperar al refresco.
  const pedidoId = nuevoIdPedido_();
  const cId = colIdPedidos_(sheet);
  while (row.length <= cId) row.push('');
  row[cId] = pedidoId;

  sheet.appendRow(row);
  const filaNueva = sheet.getLastRow();

  const esRegalo = Number(data.regalo) === 1;
  const detalles = [];
  if (esRegalo) detalles.push('regalo del club');
  if (retiraAhora) detalles.push(seña > 0 ? 'pagó ' + seña + ' de ' + total : 'sin pago, total ' + total);
  else if (seña > 0) detalles.push('seña ' + seña + ' de ' + total);
  else if (total > 0) detalles.push('sin seña, total ' + total);
  if (data.notas) detalles.push(String(data.notas));

  logMovimiento({
    tipo:     'PEDIDO_NUEVO',
    pedidoId: pedidoId,
    nombre:   data.nombre || '',
    prenda:   data.tipo || tipoKey,
    talle:    data.talle || '',
    monto:    seña,
    medio:    data.modoPago || '',
    detalle:  (data.tanda || 'SEGUNDA') + (detalles.length ? ' · ' + detalles.join(' · ') : '')
  });

  // Alta con retiro: se loguea el RETIRO aparte para que el historial quede igual que si se
  // hubiera hecho en dos pasos. La hoja Retiros ya no se escribe: duplicaba datos del pedido
  // (nombre, talle, montos) que quedaban viejos al primer cambio, y la app nunca la leía.
  if (retiraAhora) {
    const detRetiro = [];
    if (pagoRetiro > 0) detRetiro.push('pagó ' + pagoRetiro + (medioRetiro ? ' por ' + medioRetiro : ''));
    const restaFinal = Math.max(0, total - pagoRetiro);
    detRetiro.push(restaFinal > 0 ? 'queda debiendo ' + restaFinal : 'saldado');
    detRetiro.push('retirado al registrar el pedido');
    if (data.notas) detRetiro.push(String(data.notas));

    logMovimiento({
      tipo:     'RETIRO',
      pedidoId: pedidoId,
      nombre:   data.nombre || '',
      prenda:   data.tipo || tipoKey,
      talle:    data.talle || '',
      monto:    pagoRetiro,
      medio:    medioRetiro,
      detalle:  detRetiro.join(' · ')
    });
  }

  return jsonResponse({ status: 'ok', message: 'Pedido registrado', pedidoId: pedidoId });
}

// --- Registrar retiro: actualiza hoja Pedidos (Retirado=1) + agrega a hoja Retiros ---
function registrarRetiro(data) {
  // 1. Update Pedidos sheet
  const pedidosSheet = getOrCreateSheet(SHEET_PEDIDOS);
  const pedidosData = pedidosSheet.getDataRange().getValues();
  const headers = pedidosData[0];

  const colRetirado        = headers.indexOf('Retirado');
  const colSeña            = headers.indexOf('Seña');
  const colResta           = headers.indexOf('Resta');
  const colTotalTransf     = headers.indexOf('Total Transferencia');
  const colTotalEfect      = headers.indexOf('Total Efectivo');
  const colTalleRetiro     = headers.indexOf('Talle Retiro');
  const colMedioPagoRetiro = headers.indexOf('Medio de Pago Retiro');
  const colMontoRetiro     = headers.indexOf('Monto Retiro');
  const colNotasRetiro     = headers.indexOf('Notas Retiro');

  // La fila se resuelve por ID; el sheetRow del cliente es sólo un atajo que se verifica.
  const targetRow = filaDePedido_(pedidosSheet, data.pedidoId, data.sheetRow);
  if (!targetRow) {
    return jsonResponse({ status: 'error',
      message: 'No se encontró el pedido ' + (data.pedidoId || data.sheetRow) + '. No se escribió nada.' });
  }
  if (targetRow > 1 && targetRow <= pedidosData.length) {
    // Mark as retirado / desmarcar
    if (colRetirado >= 0) {
      pedidosSheet.getRange(targetRow, colRetirado + 1).setValue(data.retirado ? 1 : 0);
    }

    // Escribir / limpiar campos de retiro en hoja Pedidos
    const clearOrSet = (col, val) => {
      if (col >= 0) pedidosSheet.getRange(targetRow, col + 1).setValue(data.retirado ? val : '');
    };
    clearOrSet(colTalleRetiro,     data.talleRetiro || data.talle || '');
    clearOrSet(colMedioPagoRetiro, data.medioPago   || '');
    clearOrSet(colMontoRetiro,     Number(data.pagoRetiro) || 0);
    clearOrSet(colNotasRetiro,     data.observacion || '');

    // If there's a payment at pickup, add to seña and recalculate resta
    if (data.retirado && data.pagoRetiro && Number(data.pagoRetiro) > 0) {
      const pago = Number(data.pagoRetiro);
      if (colSeña >= 0) {
        const currentSeña = Number(pedidosData[targetRow - 1][colSeña]) || 0;
        pedidosSheet.getRange(targetRow, colSeña + 1).setValue(currentSeña + pago);
      }
      if (colResta >= 0) {
        const currentResta = Number(pedidosData[targetRow - 1][colResta]) || 0;
        pedidosSheet.getRange(targetRow, colResta + 1).setValue(Math.max(0, currentResta - pago));
      }
      if (data.medioPago === 'transferencia' && colTotalTransf >= 0) {
        const current = Number(pedidosData[targetRow - 1][colTotalTransf]) || 0;
        pedidosSheet.getRange(targetRow, colTotalTransf + 1).setValue(current + pago);
      }
      if (data.medioPago === 'efectivo' && colTotalEfect >= 0) {
        const current = Number(pedidosData[targetRow - 1][colTotalEfect]) || 0;
        pedidosSheet.getRange(targetRow, colTotalEfect + 1).setValue(current + pago);
      }
    }
  }

  // La hoja Retiros ya no se escribe: repetía nombre, talle y montos del pedido (fotos que
  // quedaban viejas al primer cambio) y la app nunca la leía. El retiro vive en las columnas
  // del propio pedido y queda registrado en Movimientos.

  // 3. Log de movimiento
  const pagoRet = Number(data.pagoRetiro) || 0;
  const talleRet = data.talleRetiro || data.talle || '';
  const detRetiro = [];
  if (talleRet && data.talle && talleRet !== data.talle) {
    detRetiro.push('retiró talle ' + talleRet + ' (pidió ' + data.talle + ')');
  }
  if (pagoRet > 0) detRetiro.push('pagó ' + pagoRet + (data.medioPago ? ' por ' + data.medioPago : ''));
  const restaFinal = Math.max(0, (Number(data.resta) || 0) - pagoRet);
  detRetiro.push(restaFinal > 0 ? 'queda debiendo ' + restaFinal : 'saldado');
  if (data.observacion) detRetiro.push(String(data.observacion));

  logMovimiento({
    tipo:     data.retirado ? 'RETIRO' : 'RETIRO_REVERTIDO',
    pedidoId: idDeFila_(pedidosSheet, targetRow) || data.pedidoId || data.id,
    nombre:   data.nombre || '',
    prenda:   data.tipo || '',
    talle:    talleRet,
    monto:    data.retirado ? pagoRet : 0,
    medio:    data.retirado ? (data.medioPago || '') : '',
    detalle:  data.retirado ? detRetiro.join(' · ') : 'Se revirtió el retiro'
  });

  return jsonResponse({ status: 'ok', message: 'Retiro registrado' });
}

// Legacy support
function updateRetiro(data) {
  return registrarRetiro(data);
}

// --- Corregir datos de un pedido ya cargado (errores de tipeo) ---
// Toca Nombre, Talle, Notas y Total. NO toca 'Talle Retiro' — el talle pedido y el que se
// entregó son cosas distintas a propósito — ni 'Seña', que es el acumulador de lo cobrado.
// El Total sí arrastra a 'Resta', que se recalcula contra lo ya pagado.
function editarPedido(data) {
  const sheet   = getOrCreateSheet(SHEET_PEDIDOS);
  const nCols   = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, nCols).getValues()[0];

  const fila = filaDePedido_(sheet, data.pedidoId, data.sheetRow);
  if (!fila) {
    return jsonResponse({ status: 'error',
      message: 'No se encontró el pedido ' + (data.pedidoId || data.sheetRow) + '. No se escribió nada.' });
  }

  const previo = sheet.getRange(fila, 1, 1, nCols).getValues()[0];
  const idx = n => headers.findIndex(h => h.toString().trim() === n);
  const get = n => { const i = idx(n); return i >= 0 ? previo[i] : ''; };
  const set = (n, v) => { const i = idx(n); if (i >= 0) sheet.getRange(fila, i + 1).setValue(v); };
  const cambios = [];
  let cambioTotal = false;

  // Campos de texto. Sólo se escriben las claves que el cliente mandó explícitamente, así un
  // campo ausente no borra lo que había en la hoja.
  [['Nombre', 'nombre'], ['Talle', 'talle'], ['Notas', 'notas'], ['Tanda', 'tanda']].forEach(function (par) {
    const col = par[0], clave = par[1];
    if (!Object.prototype.hasOwnProperty.call(data, clave) || idx(col) < 0) return;
    const nuevo = String(data[clave] == null ? '' : data[clave]);
    const viejo = String(get(col) == null ? '' : get(col));
    if (nuevo === viejo) return;
    set(col, nuevo);
    cambios.push(col + ': "' + viejo + '" → "' + nuevo + '"');
  });

  // Total: además de escribirlo hay que recalcular 'Resta' contra lo ya cobrado. Sin esto la
  // deuda quedaría calculada sobre el total viejo y el pedido mostraría plata que no debe.
  if (Object.prototype.hasOwnProperty.call(data, 'total') && idx('Total') >= 0) {
    const nuevoTotal = Number(data.total) || 0;
    const viejoTotal = Number(get('Total')) || 0;
    if (nuevoTotal !== viejoTotal) {
      const pagado = Number(get('Seña')) || 0;   // 'Seña' acumula todo lo cobrado

      // Se valida acá y no sólo en el cliente: el navegador puede estar con datos viejos (la
      // seña pudo subir desde otro dispositivo entre que abrió el modal y guardó), y dejarlo
      // pasar generaría plata a favor que la app no sabe devolver.
      if (nuevoTotal < pagado) {
        return jsonResponse({ status: 'error',
          message: 'El total no puede quedar por debajo de lo ya cobrado (' + pagado + ').' });
      }

      set('Total', nuevoTotal);
      cambios.push('total: ' + plata_(viejoTotal) + ' → ' + plata_(nuevoTotal));
      cambioTotal = true;

      if (idx('Resta') >= 0) {
        const viejaResta = Number(get('Resta')) || 0;
        const nuevaResta = nuevoTotal - pagado;   // nunca negativo: lo garantiza la validación
        if (nuevaResta !== viejaResta) {
          set('Resta', nuevaResta);
          cambios.push('resta: ' + plata_(viejaResta) + ' → ' + plata_(nuevaResta));
        }
      }
    }
  }

  // Medio de pago de la seña. No existe un campo con el medio de cada pago: lo único que hay son
  // los dos acumuladores 'Total Efectivo' y 'Total Transferencia'. Lo que este selector reasigna
  // es la parte NO cobrada al retirar ('Seña' - 'Monto Retiro'); la del retiro tiene su propio
  // editor en la pantalla de Retiros y queda intacta.
  if (Object.prototype.hasOwnProperty.call(data, 'medioSeña') &&
      idx('Total Efectivo') >= 0 && idx('Total Transferencia') >= 0) {
    const medio    = String(data['medioSeña'] || '').toLowerCase();
    const pagado   = Number(get('Seña')) || 0;
    const montoRet = Number(get('Monto Retiro')) || 0;
    const medioRet = String(get('Medio de Pago Retiro') || '').toLowerCase();
    const retEf = medioRet === 'efectivo'      ? montoRet : 0;
    const retTr = medioRet === 'transferencia' ? montoRet : 0;
    const pagadoSeña = Math.max(0, pagado - montoRet);

    const efActual = Number(get('Total Efectivo'))      || 0;
    const trActual = Number(get('Total Transferencia')) || 0;
    const efNuevo  = (medio === 'efectivo'      ? pagadoSeña : 0) + retEf;
    const trNuevo  = (medio === 'transferencia' ? pagadoSeña : 0) + retTr;

    if (pagadoSeña > 0 && (efNuevo !== efActual || trNuevo !== trActual)) {
      set('Total Efectivo', efNuevo);
      set('Total Transferencia', trNuevo);
      cambios.push('medio de la seña → ' + medio +
        ' (Efectivo ' + efActual + '→' + efNuevo + ', Transferencia ' + trActual + '→' + trNuevo + ')');
    }
  }

  if (!cambios.length) return jsonResponse({ status: 'ok', message: 'Sin cambios' });

  // Un cambio de total va con su propio tipo: es un cambio de precio, no una corrección de
  // tipeo, y en Movimientos tiene que poder encontrarse. El monto va en 0 a propósito: no es
  // plata que entró y no tiene que sumar en "Cobrado hoy".
  logMovimiento({
    tipo:     cambioTotal ? 'TOTAL_EDITADO' : 'PEDIDO_EDITADO',
    pedidoId: idDeFila_(sheet, fila) || data.pedidoId || '',
    nombre:   data.nombre || String(get('Nombre') || ''),
    prenda:   data.tipo || '',
    talle:    data.talle || '',
    monto:    0,
    medio:    '',
    detalle:  cambios.join(' · ')
  });

  return jsonResponse({ status: 'ok', message: 'Pedido actualizado', cambios: cambios,
                        totalActualizado: cambioTotal });
}

// --- Corregir los datos de un retiro ya registrado ---
// Toca talle retirado, medio de pago y observación. NO toca los importes... con una excepción
// necesaria: si cambia el medio de pago, hay que mover el 'Monto Retiro' de un acumulador al
// otro ('Total Efectivo' <-> 'Total Transferencia'). Si no, corregir el medio sería cosmético
// y los totales de efectivo/transferencia quedarían mal para siempre.
// También puede cambiar el 'Total' del pedido (viene sólo si el cliente manda la clave): es
// el caso de la prenda ya entregada que todavía se debe y a la que se le actualiza el precio.
// Igual que en editarPedido, 'Resta' se recalcula contra lo ya cobrado y 'Seña' no se toca.
function editarRetiro(data) {
  const sheet   = getOrCreateSheet(SHEET_PEDIDOS);
  const nCols   = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, nCols).getValues()[0];

  const fila = filaDePedido_(sheet, data.pedidoId, data.sheetRow);
  if (!fila) {
    return jsonResponse({ status: 'error',
      message: 'No se encontró el pedido ' + (data.pedidoId || data.sheetRow) + '. No se escribió nada.' });
  }

  const row = sheet.getRange(fila, 1, 1, nCols).getValues()[0];
  const idx = n => headers.findIndex(h => h.toString().trim() === n);
  const get = n => { const i = idx(n); return i >= 0 ? row[i] : ''; };
  const set = (n, v) => { const i = idx(n); if (i >= 0) sheet.getRange(fila, i + 1).setValue(v); };

  const talleViejo = String(get('Talle Retiro') || '');
  const medioViejo = String(get('Medio de Pago Retiro') || '').toLowerCase();
  const notasViejo = String(get('Notas Retiro') || '');
  const montoRet   = Number(get('Monto Retiro')) || 0;

  const talleNuevo = data.talleRetiro != null ? String(data.talleRetiro) : talleViejo;
  const medioNuevo = data.medioPago   != null ? String(data.medioPago).toLowerCase() : medioViejo;
  const notasNuevo = data.observacion != null ? String(data.observacion) : notasViejo;

  // El total se valida ANTES de escribir nada: si es inválido no tiene que quedar el retiro
  // corregido a medias con un error en pantalla.
  const tocaTotal  = Object.prototype.hasOwnProperty.call(data, 'total') && idx('Total') >= 0;
  const viejoTotal = Number(get('Total')) || 0;
  const nuevoTotal = tocaTotal ? (Number(data.total) || 0) : viejoTotal;
  const pagado     = Number(get('Seña')) || 0;   // 'Seña' acumula todo lo cobrado
  const cambioTotal = tocaTotal && nuevoTotal !== viejoTotal;
  if (cambioTotal && nuevoTotal < pagado) {
    return jsonResponse({ status: 'error',
      message: 'El total no puede quedar por debajo de lo ya cobrado (' + plata_(pagado) + ').' });
  }

  const cambios = [];
  if (cambioTotal) {
    set('Total', nuevoTotal);
    cambios.push('total: ' + plata_(viejoTotal) + ' → ' + plata_(nuevoTotal));
    if (idx('Resta') >= 0) {
      const viejaResta = Number(get('Resta')) || 0;
      const nuevaResta = nuevoTotal - pagado;   // nunca negativo: lo garantiza la validación
      if (nuevaResta !== viejaResta) {
        set('Resta', nuevaResta);
        cambios.push('resta: ' + plata_(viejaResta) + ' → ' + plata_(nuevaResta));
      }
    }
  }
  if (talleNuevo !== talleViejo) { set('Talle Retiro', talleNuevo); cambios.push('talle retirado: ' + (talleViejo || '—') + ' → ' + talleNuevo); }
  if (notasNuevo !== notasViejo) { set('Notas Retiro', notasNuevo); cambios.push('observación actualizada'); }

  if (medioNuevo !== medioViejo) {
    set('Medio de Pago Retiro', medioNuevo);
    cambios.push('medio de pago: ' + (medioViejo || '—') + ' → ' + medioNuevo);
    // Sin medio anterior (filas viejas) no se sabe en qué acumulador se había cargado, así que
    // no se mueve nada: se avisa para que se revise a mano en vez de descuadrar los totales.
    if (montoRet > 0 && medioViejo) {
      const colDe = medioViejo === 'transferencia' ? 'Total Transferencia' : 'Total Efectivo';
      const colA  = medioNuevo === 'transferencia' ? 'Total Transferencia' : 'Total Efectivo';
      if (colDe !== colA) {
        set(colDe, Math.max(0, (Number(get(colDe)) || 0) - montoRet));
        set(colA,  (Number(get(colA)) || 0) + montoRet);
        cambios.push('se movieron ' + montoRet + ' de ' + colDe + ' a ' + colA);
      }
    } else if (montoRet > 0) {
      cambios.push('⚠ revisar totales: no había medio anterior registrado');
    }
  }

  if (!cambios.length) return jsonResponse({ status: 'ok', message: 'Sin cambios' });

  const pedidoId = idDeFila_(sheet, fila) || data.pedidoId || '';

  // Mismo criterio que en editarPedido: el cambio de total tiene su propio tipo de movimiento
  // y va con monto 0, porque no es plata cobrada.
  logMovimiento({
    tipo:     cambioTotal ? 'TOTAL_EDITADO' : 'RETIRO_EDITADO',
    pedidoId: pedidoId,
    nombre:   String(get('Nombre') || ''),
    prenda:   data.tipo || '',
    talle:    talleNuevo,
    monto:    0,
    medio:    cambioTotal ? '' : medioNuevo,
    detalle:  cambios.join(' · ')
  });

  return jsonResponse({ status: 'ok', message: 'Retiro actualizado', cambios: cambios,
                        totalActualizado: cambioTotal });
}

// --- Registrar pago/seña adicional sin marcar como retirado ---
function registrarSeña(data) {
  const pedidosSheet = getOrCreateSheet(SHEET_PEDIDOS);
  const pedidosData = pedidosSheet.getDataRange().getValues();
  const headers = pedidosData[0];

  const colSeña        = headers.indexOf('Seña');
  const colResta       = headers.indexOf('Resta');
  const colTotalTransf = headers.indexOf('Total Transferencia');
  const colTotalEfect  = headers.indexOf('Total Efectivo');

  const targetRow = filaDePedido_(pedidosSheet, data.pedidoId, data.sheetRow);
  if (!targetRow) {
    return jsonResponse({ status: 'error',
      message: 'No se encontró el pedido ' + (data.pedidoId || data.sheetRow) + '. No se escribió nada.' });
  }
  if (targetRow < 2 || targetRow > pedidosData.length) {
    return jsonResponse({ status: 'error', message: 'Fila inválida' });
  }

  const pagoSeña = Number(data.pagoSeña) || 0;
  if (pagoSeña <= 0) {
    return jsonResponse({ status: 'error', message: 'Monto inválido' });
  }

  const rowData = pedidosData[targetRow - 1];

  const currentSeña  = Number(rowData[colSeña])  || 0;
  const currentResta = Number(rowData[colResta]) || 0;
  const newSeña  = currentSeña + pagoSeña;
  const newResta = Math.max(0, currentResta - pagoSeña);

  if (colSeña  >= 0) pedidosSheet.getRange(targetRow, colSeña  + 1).setValue(newSeña);
  if (colResta >= 0) pedidosSheet.getRange(targetRow, colResta + 1).setValue(newResta);
  if (data.medioPago === 'transferencia' && colTotalTransf >= 0) {
    const current = Number(rowData[colTotalTransf]) || 0;
    pedidosSheet.getRange(targetRow, colTotalTransf + 1).setValue(current + pagoSeña);
  }
  if (data.medioPago === 'efectivo' && colTotalEfect >= 0) {
    const current = Number(rowData[colTotalEfect]) || 0;
    pedidosSheet.getRange(targetRow, colTotalEfect + 1).setValue(current + pagoSeña);
  }

  // Datos del pedido para el log (el front no los manda en este payload)
  const colNombre = headers.indexOf('Nombre');
  const colTalle  = headers.indexOf('Talle');
  const nombrePed = colNombre >= 0 ? String(rowData[colNombre] || '') : '';
  const tallePed  = colTalle  >= 0 ? String(rowData[colTalle]  || '') : '';

  // Deducir la prenda: primera columna de tipo (flag binario) con valor 1
  let prendaPed = '';
  const noTipoCols = ['NOMBRE','TALLE','SEÑA','TOTAL','RESTA','NOTAS','TOTAL TRANSFERENCIA',
                      'TOTAL EFECTIVO','TANDA','RETIRADO','REGALO','TALLE RETIRO',
                      'MEDIO DE PAGO RETIRO','MONTO RETIRO','NOTAS RETIRO'];
  for (let c = 0; c < headers.length; c++) {
    const h = String(headers[c] || '').trim();
    if (!h || noTipoCols.indexOf(h.toUpperCase()) >= 0) continue;
    if (Number(rowData[c]) === 1) { prendaPed = h; break; }
  }

  logMovimiento({
    tipo:     'PAGO_SEÑA',
    pedidoId: idDeFila_(pedidosSheet, targetRow) || data.pedidoId || '',
    nombre:   nombrePed,
    prenda:   prendaPed,
    talle:    tallePed,
    monto:    pagoSeña,
    medio:    data.medioPago || '',
    detalle:  newResta > 0 ? 'resta ' + newResta : 'saldado'
  });

  return jsonResponse({ status: 'ok', message: 'Pago registrado' });
}

// --- Eliminar (anular) un pedido ---
// No borra la fila: escribe 1 en la columna 'Anulado'. El pedido desaparece de la app pero
// queda en la planilla y en el historial de movimientos, con el motivo y lo que se había
// cobrado, que es justamente lo que hace falta para poder auditar o revertir a mano.
function eliminarPedido(data) {
  const sheet   = getOrCreateSheet(SHEET_PEDIDOS);
  const fila    = filaDePedido_(sheet, data.pedidoId, data.sheetRow);
  if (!fila) {
    return jsonResponse({ status: 'error',
      message: 'No se encontró el pedido ' + (data.pedidoId || data.sheetRow) + '. No se borró nada.' });
  }

  // La columna se crea al vuelo la primera vez, igual que hace colIdPedidos_ con el ID
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers = asegurarColumna_(sheet, headers, PED_COL_ANULADO);
  const cAnulado = headers.map(h => String(h).trim()).indexOf(PED_COL_ANULADO);

  const nCols  = sheet.getLastColumn();
  const previo = sheet.getRange(fila, 1, 1, nCols).getValues()[0];
  const idx = n => headers.findIndex(h => h.toString().trim() === n);
  const get = n => { const i = idx(n); return i >= 0 ? previo[i] : ''; };

  // Idempotente: si ya estaba anulado no se vuelve a loguear. Con las escrituras a ciegas el
  // cliente puede reintentar sin saberlo, y dos movimientos de borrado confunden más que ayudan.
  if (Number(previo[cAnulado]) === 1) {
    return jsonResponse({ status: 'ok', message: 'El pedido ya estaba eliminado', yaEstaba: true });
  }

  const nombre   = String(get('Nombre') || '');
  const talle    = String(get('Talle')  || '');
  const total    = Number(get('Total')) || 0;
  const cobrado  = Number(get('Seña'))  || 0;   // 'Seña' acumula todo lo cobrado
  const retirado = Number(get('Retirado')) === 1;

  // Prenda: las columnas de tipo son flags binarios, se busca la que está en 1
  let prenda = String(data.prenda || '');
  if (!prenda) {
    const tipoCols = ['BLANCA', 'AZUL', 'SHORT', 'CHOMBA', 'ARQUERO_CELESTE', 'ARQUERO_NEGRA'];
    headers.forEach(function (h, i) {
      const key = String(h).trim().toUpperCase();
      if (tipoCols.indexOf(key) >= 0 && Number(previo[i]) === 1) prenda = key;
    });
  }

  sheet.getRange(fila, cAnulado + 1).setValue(1);

  const det = [];
  det.push('total ' + total);
  if (cobrado > 0) det.push('tenía ' + cobrado + ' cobrados que salen de la caja');
  if (retirado)    det.push('estaba retirado: la prenda vuelve a contar como disponible');
  if (data.motivo) det.push('motivo: ' + String(data.motivo));

  logMovimiento({
    tipo:     'PEDIDO_ELIMINADO',
    pedidoId: idDeFila_(sheet, fila) || data.pedidoId || '',
    nombre:   nombre,
    prenda:   prenda,
    talle:    talle,
    // monto 0 a propósito: lo cobrado NO es plata que entró hoy. Si fuera a 'monto' se sumaría
    // al KPI "Cobrado hoy" y la tarjeta mostraría un +$ en verde, justo al revés de lo que pasó.
    // El importe queda dicho en el detalle, que es donde se lee sin confundirlo con un ingreso.
    monto:    0,
    medio:    '',
    detalle:  det.join(' · ')
  });

  return jsonResponse({ status: 'ok', message: 'Pedido eliminado', cobrado: cobrado });
}

// ============ JSON Response ============
// Las funciones siguen devolviendo jsonResponse({...}), pero lo que devuelve es el objeto
// envuelto: el texto final lo arma emitir_ en doGet/doPost, cuando ya se sabe cuánto tardó todo.
function jsonResponse(obj) {
  return { __json: obj };
}

function emitir_(r) {
  const obj = (r && r.__json) ? r.__json : (r || {});
  obj.ms = Date.now() - _T0;
  obj.t  = _marcas;
  obj.ini = _T0;      // hora del servidor al empezar: para ver si la espera fue antes o después
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
