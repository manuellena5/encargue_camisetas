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
- **Movimientos**: historial de toda la actividad (pedidos, pagos, retiros, stock)

## Google Sheet

El Sheet tiene estas hojas:
- **Pedidos**: todos los pedidos con columnas Nombre, BLANCA, AZUL, SHORT, CHOMBA, Talle, Seña, Total, Resta, Notas, Total Transferencia, Total Efectivo, Tanda, Retirado, Regalo, Fecha Alta
- **Retiros**: log de cada retiro realizado
- **Stock**: stock por tipo y talle (`Tipo | Talle | Stock | Última Actualización`)
- **Movimientos**: historial de actividad, una fila por acción (`Fecha | Tipo | Pedido ID | Nombre | Prenda | Talle | Monto | Medio | Detalle`). Se crea sola la primera vez que se registra algo.

## Registro de movimientos

Cada acción sobre la app deja una fila en la hoja **Movimientos**:

| Tipo | Cuándo se registra |
|---|---|
| `PEDIDO_NUEVO` | Se da de alta un pedido |
| `PAGO_SEÑA` | Se cobra una seña o un pago parcial |
| `RETIRO` | Se marca un pedido como retirado |
| `RETIRO_REVERTIDO` | Se desmarca un retiro |
| `STOCK` | Se edita el stock de un tipo de prenda (guarda el antes → después de cada talle) |

La columna **Fecha Alta** de la hoja Pedidos se crea sola con el primer pedido nuevo y guarda cuándo se cargó cada uno. Las listas de Pedidos y Retiros ordenan por ese dato, del más reciente al más viejo. Los pedidos anteriores a este cambio no la tienen y quedan al final, ordenados por su posición en la hoja; si querés, se puede completar a mano en el Sheet con el formato `yyyy-MM-dd HH:mm:ss`.

Las fechas se guardan siempre en huso horario de Argentina (`America/Argentina/Buenos_Aires`), con formato `yyyy-MM-dd HH:mm:ss`, sin importar la zona horaria del dispositivo.

La pantalla **Movim.** pide al backend solo el rango elegido (7 / 30 / 90 días o todo), con un tope de 500 filas por consulta. El backend recorre la hoja de abajo hacia arriba y corta apenas pasa la fecha de inicio, así el historial puede crecer sin que la app se ponga lenta.

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
