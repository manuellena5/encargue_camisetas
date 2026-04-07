# Gestión Prendas del Club

Webapp para controlar pedidos, retiros y stock de prendas del club. Los datos se leen y escriben en Google Sheets.

## Funcionalidades

- **Pedidos y Retiros**: tabs por tipo de prenda (Blanca, Azul, Chomba, Short, Todos)
- **Nuevo Pedido**: formulario para registrar pedidos nuevos (2da tanda)
- **Stock en tiempo real**: muestra stock restante de camisetas por talle
- **Retiros**: marcar retiros con pago, medio de pago y observaciones
- **Sincronización**: todo se lee y escribe en Google Sheets
- **Multi-usuario**: varias personas pueden usar la app simultaneamente
- **Recaudación**: desglose en efectivo y transferencia

## Google Sheet

El Sheet tiene dos hojas:
- **Pedidos**: todos los pedidos con columnas Nombre, BLANCA, AZUL, SHORT, CHOMBA, Talle, Seña, Total, Resta, Notas, Total Transferencia, Total Efectivo, Tanda, Retirado
- **Retiros**: log de cada retiro realizado

## Setup

### 1. Google Apps Script

1. Abrir el Google Sheet: `https://docs.google.com/spreadsheets/d/1EVLGu97_2A_TRx6-udU2tOIaE_tVXULGCJ_rMpP1UeM/edit`
2. Ir a **Extensiones > Apps Script**
3. Pegar el contenido de `google-apps-script.js` reemplazando todo
4. Verificar que el `SPREADSHEET_ID` sea correcto
5. **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copiar la URL del deployment

### 2. Subir a GitHub Pages

```bash
cd camisetas-club-app
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU_USUARIO/camisetas-club.git
git push -u origin main
```

Activar GitHub Pages en **Settings > Pages > Source: main branch**.

### 3. Configurar la webapp

Al abrir la webapp por primera vez, pegar la URL del Apps Script en el panel de configuración.
