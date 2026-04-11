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
      obj[headers[j]] = data[i][j];
    }
    obj._row = i + 1; // 1-indexed row number in sheet
    rows.push(obj);
  }
  return rows;
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
    if (action === 'getAll') {
      return getAll();
    }

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function getAll() {
  const pedidosSheet = getOrCreateSheet(SHEET_PEDIDOS);
  const retirosSheet = getOrCreateSheet(SHEET_RETIROS, [
    'ID', 'Nombre', 'Tipo', 'Talle Pedido', 'Talle Retiro', 'Seña', 'Total', 'Resta',
    'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro'
  ]);

  const pedidos = sheetToObjects(pedidosSheet);
  const retiros = sheetToObjects(retirosSheet);

  return jsonResponse({ status: 'ok', pedidos, retiros });
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
    return '';
  });

  sheet.appendRow(row);
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

  return jsonResponse({ status: 'ok', message: 'Retiro registrado' });
}

// Legacy support
function updateRetiro(data) {
  return registrarRetiro(data);
}

// ============ Stock: guardar en hoja Stock ============
// data: { tipo: 'BLANCA', stock: { XS: 2, S: 6, M: 10, L: 8, XL: 4, XXL: 2 } }
function guardarStock(data) {
  const TALLES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const headers = ['Tipo', ...TALLES, 'Última Actualización'];

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_STOCK);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const tipo = (data.tipo || '').toUpperCase();
  const stock = data.stock || {};
  const allData = sheet.getDataRange().getValues();
  const sheetHeaders = allData[0];
  const colTipo = sheetHeaders.indexOf('Tipo');

  // Buscar fila existente para este tipo
  let targetRow = -1;
  for (let i = 1; i < allData.length; i++) {
    if ((allData[i][colTipo] || '').toString().toUpperCase() === tipo) {
      targetRow = i + 1; // 1-indexed
      break;
    }
  }

  const rowValues = [tipo, ...TALLES.map(t => Number(stock[t]) || 0), new Date()];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return jsonResponse({ status: 'ok', message: `Stock de ${tipo} guardado` });
}

// ============ JSON Response ============
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
