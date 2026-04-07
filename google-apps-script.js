// =====================================================
// GOOGLE APPS SCRIPT - Backend para Gestión Camisetas
// =====================================================
// INSTRUCCIONES:
// 1. Abrí https://script.google.com y creá un nuevo proyecto
// 2. Pegá este código completo reemplazando todo lo existente
// 3. Cambiá SPREADSHEET_ID por el ID de tu Google Sheet
// 4. La hoja "Pedidos" debe existir con encabezados en la fila 1
//    (Nombre, BLANCA, AZUL, CHOMBA, SHORT, Talle, Tanda, Seña, Total,
//     Resta, Notas, Total Efectivo, Total Transferencia, Retirado, Talle Retiro)
//    Agrega la columna "Talle Retiro" si no existe todavía.
// 5. La hoja "Retiros" se crea automáticamente si no existe.
// 6. Hacé Deploy > New deployment > Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 7. Copiá la URL del deployment y pegala en la webapp
// =====================================================

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_ACA'; // <-- CAMBIAR ESTO
const SHEET_PEDIDOS = 'Pedidos';
const SHEET_RETIROS = 'Retiros';

function getPedidosSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_PEDIDOS);
}

function getRetirosSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_RETIROS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RETIROS);
    sheet.appendRow(['ID', 'Nombre', 'Tipo', 'Talle', 'Seña', 'Total', 'Resta', 'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getAll') {
    return getAllPedidos();
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'registrarRetiro') {
      return registrarRetiro(data);
    }

    if (data.action === 'nuevoPedido') {
      return nuevoPedido(data);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action: ' + data.action }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lee todos los pedidos de la hoja "Pedidos" y los devuelve como array de objetos
// con las claves tomadas de la primera fila (encabezados).
function getAllPedidos() {
  const sheet = getPedidosSheet();
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Hoja "Pedidos" no encontrada' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', pedidos: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const headers = data[0];
  const pedidos = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = { _row: i + 1 }; // número de fila en la hoja (1-indexed)
    headers.forEach((h, j) => {
      obj[h] = row[j];
    });
    pedidos.push(obj);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', pedidos }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Marca o desmarca un retiro:
//  - Actualiza columnas "Retirado" y "Talle Retiro" en la hoja "Pedidos".
//  - Escribe/actualiza una fila en la hoja "Retiros" (o la elimina si se desmarca).
function registrarRetiro(data) {
  // 1. Actualizar hoja Pedidos
  const pedidosSheet = getPedidosSheet();
  if (pedidosSheet && data.sheetRow) {
    const headers = pedidosSheet.getRange(1, 1, 1, pedidosSheet.getLastColumn()).getValues()[0];
    const retiradoCol = headers.indexOf('Retirado') + 1;
    const talleRetiroCol = headers.indexOf('Talle Retiro') + 1;
    const medioPagoRetiroCol = headers.indexOf('Medio de Pago Retiro') + 1;
    const montoRetiroCol = headers.indexOf('Monto Retiro') + 1;
    const notasRetiroCol = headers.indexOf('Notas Retiro') + 1;

    if (retiradoCol > 0) {
      pedidosSheet.getRange(data.sheetRow, retiradoCol).setValue(data.retirado ? 1 : 0);
    }
    if (talleRetiroCol > 0) {
      pedidosSheet.getRange(data.sheetRow, talleRetiroCol).setValue(
        data.retirado ? (data.talleRetiro || data.talle || '') : ''
      );
    }
    if (medioPagoRetiroCol > 0) {
      pedidosSheet.getRange(data.sheetRow, medioPagoRetiroCol).setValue(
        data.retirado ? (data.medioPago || '') : ''
      );
    }
    if (montoRetiroCol > 0) {
      pedidosSheet.getRange(data.sheetRow, montoRetiroCol).setValue(
        data.retirado ? (Number(data.pagoRetiro) || 0) : ''
      );
    }
    if (notasRetiroCol > 0) {
      pedidosSheet.getRange(data.sheetRow, notasRetiroCol).setValue(
        data.retirado ? (data.observacion || '') : ''
      );
    }
  }

  // 2. Actualizar hoja Retiros
  const retirosSheet = getRetirosSheet();
  const allData = retirosSheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(data.id)) {
      rowIndex = i + 1; // 1-indexed
      break;
    }
  }

  if (data.retirado) {
    const row = [
      data.id,                              // ID
      data.nombre,                          // Nombre
      data.tipo,                            // Tipo
      data.talleRetiro || data.talle || '', // Talle (el retirado efectivamente)
      data.seña,                            // Seña
      data.total,                           // Total
      data.resta,                           // Resta
      1,                                    // Retirado
      data.pagoRetiro,                      // Pago al Retirar
      data.medioPago,                       // Medio de Pago
      data.observacion,                     // Observación
      data.fecha                            // Fecha Retiro
    ];
    if (rowIndex > 0) {
      retirosSheet.getRange(rowIndex, 1, 1, 12).setValues([row]);
    } else {
      retirosSheet.appendRow(row);
    }
  } else {
    // Desmarcar retiro: eliminar fila de Retiros si existe
    if (rowIndex > 0) {
      retirosSheet.deleteRow(rowIndex);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Agrega un nuevo pedido a la hoja "Pedidos" usando los encabezados existentes.
function nuevoPedido(data) {
  const sheet = getPedidosSheet();
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Hoja "Pedidos" no encontrada' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = new Array(headers.length).fill('');

  const set = (col, val) => {
    const idx = headers.indexOf(col);
    if (idx >= 0) newRow[idx] = val;
  };

  const tipoLower = (data.tipo || '').toLowerCase();
  set('Nombre', data.nombre);
  set('Talle', data.talle);
  set('Seña', Number(data.seña) || 0);
  set('Total', Number(data.total) || 0);
  set('Resta', (Number(data.total) || 0) - (Number(data.seña) || 0));
  set('Tanda', data.tanda || '');
  set('Notas', data.notas || '');
  set('Retirado', 0);
  set('Talle Retiro', '');
  set('BLANCA', tipoLower.includes('blanca') ? 1 : 0);
  set('AZUL', tipoLower.includes('azul') ? 1 : 0);
  set('CHOMBA', tipoLower.includes('chomba') ? 1 : 0);
  set('SHORT', tipoLower.includes('short') ? 1 : 0);

  if ((data.modoPago || '').toLowerCase() === 'efectivo') {
    set('Total Efectivo', Number(data.seña) || 0);
    set('Total Transferencia', 0);
  } else {
    set('Total Transferencia', Number(data.seña) || 0);
    set('Total Efectivo', 0);
  }

  sheet.appendRow(newRow);

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
