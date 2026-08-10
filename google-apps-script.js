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
const SHEET_STOCK   = 'Stock';
const SHEET_MOVIMIENTOS = 'Movimientos';

// Huso horario de Argentina: todas las fechas del log se guardan en esta zona
const TZ_AR = 'America/Argentina/Buenos_Aires';
const MOV_HEADERS = ['Fecha', 'Tipo', 'Pedido ID', 'Nombre', 'Prenda', 'Talle', 'Monto', 'Medio', 'Detalle'];

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

  const pedidos = sheetToObjects(pedidosSheet);
  const retiros = sheetToObjects(retirosSheet);
  const stock = getStock();
  const movimientos = leerMovimientos(desde, hasta, limitMov);

  return jsonResponse({ status: 'ok', pedidos, retiros, stock, movimientos, hoyAR: ahoraAR().slice(0, 10) });
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

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

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

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// --- Nuevo pedido: agrega fila a hoja Pedidos ---
// Acepta 'tipoKey' (ej: 'ARQUERO_CELESTE') y crea la columna en la hoja si no existe.
function nuevoPedido(data) {
  // Validar que la seña no supere el total
  const seña  = Number(data.seña)  || 0;
  const total = Number(data.total) || 0;
  if (total > 0 && seña > total) {
    return jsonResponse({ status: 'error', message: `La seña (${seña}) no puede superar el total (${total})` });
  }

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
    if (key === 'Retirado') return 0;
    if (key === 'Regalo') return Number(data.regalo) || 0;
    if (key === 'Fecha Alta') return ahoraAR();
    return '';
  });

  sheet.appendRow(row);

  const esRegalo = Number(data.regalo) === 1;
  const detalles = [];
  if (esRegalo) detalles.push('regalo del club');
  if (seña > 0) detalles.push('seña ' + seña + ' de ' + total);
  else if (total > 0) detalles.push('sin seña, total ' + total);
  if (data.notas) detalles.push(String(data.notas));

  logMovimiento({
    tipo:    'PEDIDO_NUEVO',
    nombre:  data.nombre || '',
    prenda:  data.tipo || tipoKey,
    talle:   data.talle || '',
    monto:   seña,
    medio:   data.modoPago || '',
    detalle: (data.tanda || 'SEGUNDA') + (detalles.length ? ' · ' + detalles.join(' · ') : '')
  });

  return jsonResponse({ status: 'ok', message: 'Pedido registrado' });
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

  const targetRow = Number(data.sheetRow);
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

  // 2. Add/update Retiros sheet
  const retirosSheet = getOrCreateSheet(SHEET_RETIROS, [
    'ID', 'Nombre', 'Tipo', 'Talle Pedido', 'Talle Retiro', 'Seña', 'Total', 'Resta',
    'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro'
  ]);

  // Check if row already exists in Retiros
  const retirosData = retirosSheet.getDataRange().getValues();
  let retiroRow = -1;
  for (let i = 1; i < retirosData.length; i++) {
    if (retirosData[i][0] == data.id) {
      retiroRow = i + 1;
      break;
    }
  }

  const retiroValues = [
    data.id,
    data.nombre,
    data.tipo,
    data.talle,
    data.talleRetiro || data.talle,
    data.seña,
    data.total,
    data.resta,
    data.retirado ? 'TRUE' : 'FALSE',
    data.pagoRetiro || 0,
    data.medioPago || '',
    data.observacion || '',
    data.fecha || ''
  ];

  if (retiroRow > 0) {
    retirosSheet.getRange(retiroRow, 1, 1, 13).setValues([retiroValues]);
  } else {
    retirosSheet.appendRow(retiroValues);
  }

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
    pedidoId: data.id,
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

// --- Registrar pago/seña adicional sin marcar como retirado ---
function registrarSeña(data) {
  const pedidosSheet = getOrCreateSheet(SHEET_PEDIDOS);
  const pedidosData = pedidosSheet.getDataRange().getValues();
  const headers = pedidosData[0];

  const colSeña        = headers.indexOf('Seña');
  const colResta       = headers.indexOf('Resta');
  const colTotalTransf = headers.indexOf('Total Transferencia');
  const colTotalEfect  = headers.indexOf('Total Efectivo');

  const targetRow = Number(data.sheetRow);
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

  // Sincronizar hoja Retiros si existe una fila para este pedido
  if (data.pedidoId) {
    const retirosSheet = getOrCreateSheet(SHEET_RETIROS, [
      'ID', 'Nombre', 'Tipo', 'Talle Pedido', 'Talle Retiro', 'Seña', 'Total', 'Resta',
      'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro'
    ]);
    const retirosData   = retirosSheet.getDataRange().getValues();
    const rHeaders      = retirosData[0];
    const rColSeña      = rHeaders.indexOf('Seña');
    const rColResta     = rHeaders.indexOf('Resta');
    for (let i = 1; i < retirosData.length; i++) {
      if (String(retirosData[i][0]) === String(data.pedidoId)) {
        if (rColSeña  >= 0) retirosSheet.getRange(i + 1, rColSeña  + 1).setValue(newSeña);
        if (rColResta >= 0) retirosSheet.getRange(i + 1, rColResta + 1).setValue(newResta);
        break;
      }
    }
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
    pedidoId: data.pedidoId || '',
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
