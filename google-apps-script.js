// =====================================================
// GOOGLE APPS SCRIPT - Backend para Gestión Camisetas
// =====================================================
// INSTRUCCIONES:
// 1. Abrí https://script.google.com y creá un nuevo proyecto
// 2. Pegá este código completo reemplazando todo lo existente
// 3. Cambiá SPREADSHEET_ID por el ID de tu Google Sheet
// 4. Hacé Deploy > New deployment > Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copiá la URL del deployment y pegala en la webapp
// =====================================================

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_ACA'; // <-- CAMBIAR ESTO
const SHEET_NAME = 'Retiros';

function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['ID', 'Nombre', 'Tipo', 'Talle', 'Seña', 'Total', 'Resta', 'Retirado', 'Pago al Retirar', 'Medio de Pago', 'Observación', 'Fecha Retiro']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getAll') {
    return getAllRetiros();
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'update') {
      return updateRetiro(data);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getAllRetiros() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const retiros = [];

  for (let i = 1; i < data.length; i++) {
    retiros.push({
      id: data[i][0],
      nombre: data[i][1],
      tipo: data[i][2],
      talle: data[i][3],
      seña: data[i][4],
      total: data[i][5],
      resta: data[i][6],
      retirado: data[i][7],
      pago: data[i][8],
      medioPago: data[i][9],
      observacion: data[i][10],
      fecha: data[i][11]
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', retiros }))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateRetiro(data) {
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  let rowIndex = -1;

  // Buscar si ya existe la fila con ese ID
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] == data.id) {
      rowIndex = i + 1; // +1 porque sheets es 1-indexed
      break;
    }
  }

  const row = [
    data.id,
    data.nombre,
    data.tipo,
    data.talle,
    data.seña,
    data.total,
    data.resta,
    data.retirado,
    data.pago,
    data.medioPago,
    data.observacion,
    data.fecha
  ];

  if (rowIndex > 0) {
    // Actualizar fila existente
    sheet.getRange(rowIndex, 1, 1, 12).setValues([row]);
  } else {
    // Agregar nueva fila
    sheet.appendRow(row);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
