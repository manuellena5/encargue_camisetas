// =====================================================
// GOOGLE APPS SCRIPT - Backend Gestión Camisetas v2
// =====================================================
// INSTRUCCIONES:
// 1. Abrí https://script.google.com y creá un nuevo proyecto
// 2. Pegá este código completo reemplazando todo lo existente
// 3. Cambiá SPREADSHEET_ID por el ID de tu Google Sheet
// 4. Asegurate de tener dos hojas: "Pedidos" y "Retiros"
// 5. Deploy > New deployment > Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 6. Copiá la URL del deployment y pegala en la webapp
// =====================================================

const SPREADSHEET_ID = '1EVLGu97_2A_TRx6-udU2tOIaE_tVXULGCJ_rMpP1UeM';
const SHEET_PEDIDOS = 'Pedidos';
const SHEET_RETIROS = 'Retiros';
const SHEET_STOCK   = 'Stock';        // legacy: dos fotos de "stock inicial" por tanda
const SHEET_COMPRAS = 'Compras';      // reemplazo: una fila por compra, con costo
const SHEET_MOVIMIENTOS = 'Movimientos';

// Huso horario de Argentina: todas las fechas del log se guardan en esta zona
const TZ_AR = 'America/Argentina/Buenos_Aires';
const MOV_HEADERS = ['Fecha', 'Tipo', 'Pedido ID', 'Nombre', 'Prenda', 'Talle', 'Monto', 'Medio', 'Detalle'];
const COM_HEADERS = ['ID', 'Fecha', 'Tanda', 'Prenda', 'Talle', 'Cantidad', 'Costo Unitario', 'Notas'];

// ============ IDENTIDAD DE UN PEDIDO ============
// Hasta acá un pedido se identificaba por su número de fila. Alcanzaba con borrar o reordenar
// una fila en la planilla para que todas las referencias (retiros, movimientos) apuntaran al
// pedido equivocado, en silencio. Ahora la columna ID es la referencia real y la fila es sólo
// un atajo que se verifica antes de escribir.
const PED_COL_ID = 'ID';

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

// ============ HELPERS ============

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
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

// Normaliza el valor de la celda Fecha a string 'yyyy-MM-dd HH:mm:ss' en hora AR.
// Contempla que Sheets pueda devolver un Date en vez del string guardado.
function fechaMovToStr(val) {
  if (val instanceof Date) return Utilities.formatDate(val, TZ_AR, 'yyyy-MM-dd HH:mm:ss');
  return String(val || '').trim();
}

// Registra un movimiento. Nunca debe romper la operación principal.
// m: { tipo, pedidoId, nombre, prenda, talle, monto, medio, detalle }
function logMovimiento(m) {
  try {
    const sheet = getOrCreateSheet(SHEET_MOVIMIENTOS, MOV_HEADERS);
    sheet.appendRow([
      ahoraAR(),
      m.tipo     || '',
      m.pedidoId || '',
      m.nombre   || '',
      m.prenda   || '',
      m.talle    || '',
      Number(m.monto) || 0,
      m.medio    || '',
      m.detalle  || ''
    ]);
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
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const max = Number(limit) > 0 ? Number(limit) : 500;
  const desdeD = desde ? String(desde).slice(0, 10) : '';
  const hastaD = hasta ? String(hasta).slice(0, 10) : '';

  const CHUNK = 300;
  const out = [];
  let end = lastRow;
  let cortar = false;

  while (end >= 2 && out.length < max && !cortar) {
    const start = Math.max(2, end - CHUNK + 1);
    const values = sheet.getRange(start, 1, end - start + 1, MOV_HEADERS.length).getValues();

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
        detalle:  String(values[i][8] || '')
      });

      if (out.length >= max) break;
    }
    end = start - 1;
  }

  return out;
}

// ============ GET: Read all data ============

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === 'getPedidos') {
      return getPedidos();
    }
    if (action === 'getRetiros') {
      return getRetiros();
    }
    if (action === 'getMovimientos') {
      return jsonResponse({
        status: 'ok',
        movimientos: leerMovimientos(e.parameter.desde, e.parameter.hasta, e.parameter.limitMov)
      });
    }
    if (action === 'getAll') {
      return getAll(e.parameter.desde, e.parameter.hasta, e.parameter.limitMov);
    }

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function getAll(desde, hasta, limitMov) {
  const pedidosSheet = getOrCreateSheet(SHEET_PEDIDOS);
  const retirosSheet = getOrCreateSheet(SHEET_RETIROS, [
    'ID', 'Nombre', 'Tipo', 'Talle Pedido', 'Talle Retiro', 'Seña', 'Total', 'Resta',
    'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro'
  ]);

  // Se completan los IDs que falten antes de leer, así los pedidos salen siempre con el suyo
  const backfill = backfillIdsPedidos_();
  const pedidos = sheetToObjects(pedidosSheet);
  const retiros = sheetToObjects(retirosSheet);   // se sigue devolviendo, pero la app ya no la lee
  const stock = getStock();
  const migracion = migrarStockACompras_();
  const compras = getCompras();
  const movimientos = leerMovimientos(desde, hasta, limitMov);

  return jsonResponse({ status: 'ok', pedidos, retiros, stock, compras, movimientos,
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

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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

// Leer stock desde la hoja Stock (formato: Tipo | Talle | Stock | Última Actualización)
function getStock() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) return { primera: {}, segunda: {} };
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { primera: {}, segunda: {} };
  
  const stockPrimera = {};
  const stockSegunda = {};
  
  // Formato: fila 0 = headers, resto = datos
  // Columnas esperadas: Tipo | Talle | Stock | Última Actualización
  for (let i = 1; i < data.length; i++) {
    const tipoRaw = String(data[i][0] || '').trim().toUpperCase();
    const talle = String(data[i][1] || '').trim().toUpperCase();
    const cantidad = Number(data[i][2]) || 0;
    
    if (!tipoRaw || !talle) continue;
    
    const esSegunda = tipoRaw.endsWith('_2DA');
    const tipoClean = tipoRaw.replace('_2DA', '').toLowerCase();
    
    if (esSegunda) {
      if (!stockSegunda[tipoClean]) stockSegunda[tipoClean] = {};
      stockSegunda[tipoClean][talle] = cantidad;
    } else {
      if (!stockPrimera[tipoClean]) stockPrimera[tipoClean] = {};
      stockPrimera[tipoClean][talle] = cantidad;
    }
  }
  
  return { primera: stockPrimera, segunda: stockSegunda };
}

function getPedidos() {
  const sheet = getOrCreateSheet(SHEET_PEDIDOS);
  const pedidos = sheetToObjects(sheet);
  return jsonResponse({ status: 'ok', pedidos });
}

function getRetiros() {
  const sheet = getOrCreateSheet(SHEET_RETIROS, [
    'ID', 'Nombre', 'Tipo', 'Talle Pedido', 'Talle Retiro', 'Seña', 'Total', 'Resta',
    'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro'
  ]);
  const retiros = sheetToObjects(sheet);
  return jsonResponse({ status: 'ok', retiros });
}

// ============ POST: Write data ============

// Serializa TODAS las escrituras. Sin esto, dos personas usando la app al mismo tiempo pueden
// leer los mismos índices de fila antes de escribir: la segunda termina operando sobre una fila
// que ya no es la que creía, y pisa el pedido equivocado. Con multiusuario no es hipotético.
// Las lecturas (doGet) NO toman el lock, para que un getAll largo no trabe un guardado.
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return jsonResponse({ status: 'error',
      message: 'El servidor está ocupado con otra operación. Probá de nuevo en unos segundos.' });
  }
  try {
    return rutearPost_(e);
  } finally {
    lock.releaseLock();
  }
}

function rutearPost_(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // Sirve para que la app pruebe si el navegador puede leer las respuestas de un POST
    if (action === 'ping') {
      return jsonResponse({ status: 'ok', pong: true, hoyAR: ahoraAR() });
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
    if (action === 'guardarStock') {
      return guardarStock(data);
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
    if (action === 'guardarCompra') {
      return guardarCompra(data);
    }
    if (action === 'actualizarCostoCompra') {
      return actualizarCostoCompra(data);
    }

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
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

  // Campos de texto. Sólo se escriben las claves que el cliente mandó explícitamente, así un
  // campo ausente no borra lo que había en la hoja.
  [['Nombre', 'nombre'], ['Talle', 'talle'], ['Notas', 'notas']].forEach(function (par) {
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
      cambios.push('Total: ' + viejoTotal + ' → ' + nuevoTotal);

      if (idx('Resta') >= 0) {
        const viejaResta = Number(get('Resta')) || 0;
        const nuevaResta = nuevoTotal - pagado;   // nunca negativo: lo garantiza la validación
        if (nuevaResta !== viejaResta) {
          set('Resta', nuevaResta);
          cambios.push('Resta recalculada: ' + viejaResta + ' → ' + nuevaResta);
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

  logMovimiento({
    tipo:     'PEDIDO_EDITADO',
    pedidoId: idDeFila_(sheet, fila) || data.pedidoId || '',
    nombre:   data.nombre || String(get('Nombre') || ''),
    prenda:   data.tipo || '',
    talle:    data.talle || '',
    monto:    0,
    medio:    '',
    detalle:  cambios.join(' · ')
  });

  return jsonResponse({ status: 'ok', message: 'Pedido actualizado', cambios: cambios });
}

// --- Corregir los datos de un retiro ya registrado ---
// Toca talle retirado, medio de pago y observación. NO toca los importes... con una excepción
// necesaria: si cambia el medio de pago, hay que mover el 'Monto Retiro' de un acumulador al
// otro ('Total Efectivo' <-> 'Total Transferencia'). Si no, corregir el medio sería cosmético
// y los totales de efectivo/transferencia quedarían mal para siempre.
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

  const cambios = [];
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

  logMovimiento({
    tipo:     'RETIRO_EDITADO',
    pedidoId: pedidoId,
    nombre:   String(get('Nombre') || ''),
    prenda:   data.tipo || '',
    talle:    talleNuevo,
    monto:    0,
    medio:    medioNuevo,
    detalle:  cambios.join(' · ')
  });

  return jsonResponse({ status: 'ok', message: 'Retiro actualizado', cambios: cambios });
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

// ============ Stock: guardar en hoja Stock ============
// Formato: Tipo | Talle | Stock | Última Actualización (una fila por cada tipo+talle)
// data: { tipo: 'BLANCA', stock: { XS: 2, S: 6, M: 10, L: 8, XL: 4, XXL: 2 }, tanda: 'PRIMERA' o 'SEGUNDA' }
function guardarStock(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_STOCK);
  
  if (!sheet) {
    // Crear hoja nueva con estructura de filas
    sheet = ss.insertSheet(SHEET_STOCK);
    sheet.appendRow(['Tipo', 'Talle', 'Stock', 'Última Actualización']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const tanda = data.tanda || 'PRIMERA';
  const tipo = (data.tipo || '').toUpperCase() + (tanda === 'SEGUNDA' ? '_2DA' : '');
  const stock = data.stock || {};
  const timestamp = new Date();
  
  // Obtener todos los datos existentes
  const allData = sheet.getDataRange().getValues();
  const existingRows = {}; // Map de "TIPO_TALLE" -> rowIndex
  const valoresPrevios = {}; // Map de "TIPO_TALLE" -> cantidad anterior

  for (let i = 1; i < allData.length; i++) {
    const rowTipo = String(allData[i][0] || '').trim().toUpperCase();
    const rowTalle = String(allData[i][1] || '').trim().toUpperCase();
    const key = `${rowTipo}_${rowTalle}`;
    existingRows[key] = i + 1; // 1-indexed
    valoresPrevios[key] = Number(allData[i][2]) || 0;
  }

  const cambios = []; // para el log: solo los talles que efectivamente cambiaron

  // Actualizar o crear filas para cada talle
  Object.keys(stock).forEach(talle => {
    const key = `${tipo}_${talle.toUpperCase()}`;
    const cantidad = Number(stock[talle]) || 0;
    const rowValues = [tipo, talle.toUpperCase(), cantidad, timestamp];
    const previo = existingRows[key] ? valoresPrevios[key] : 0;

    if (cantidad !== previo) {
      cambios.push(`${talle.toUpperCase()}: ${previo} → ${cantidad}`);
    }

    if (existingRows[key]) {
      // Actualizar fila existente
      sheet.getRange(existingRows[key], 1, 1, 4).setValues([rowValues]);
    } else {
      // Agregar nueva fila
      sheet.appendRow(rowValues);
    }
  });

  if (cambios.length) {
    logMovimiento({
      tipo:    'STOCK',
      prenda:  data.tipo || tipo,
      detalle: tanda === 'SEGUNDA' ? '2da tanda · ' + cambios.join(' · ')
                                   : '1era tanda · ' + cambios.join(' · ')
    });
  }

  return jsonResponse({ status: 'ok', message: `Stock de ${tipo} guardado` });
}

// ============ JSON Response ============
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
