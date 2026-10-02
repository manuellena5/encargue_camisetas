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
- **Compras**: una fila por compra de mercadería (prenda, talle, tanda, cantidad y costo). De acá sale el stock: lo comprado menos lo entregado.
- **Movimientos**: historial de actividad, una fila por acción (`Fecha | Tipo | Pedido ID | Nombre | Prenda | Talle | Monto | Medio | Detalle | Usuario`). Se crea sola la primera vez que se registra algo.
- **Usuarios** (optativa): quién usa la app. `Nombre | Clave | Activo`. Ver "Usuarios" más abajo.

Las hojas **Retiros** y **Stock** ya no se usan: el retiro vive en las columnas del propio pedido y el stock se calcula desde Compras. El Apps Script no las lee ni las vuelve a crear.

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

1. Abrir el Google Sheet del club
2. Ir a **Extensiones > Apps Script**
3. Pegar el contenido de `google-apps-script.js` reemplazando todo
4. Cargar el ID de la planilla como propiedad del script (no va en el código, porque este repositorio es público):
   **Configuración del proyecto (engranaje) > Propiedades del script > Agregar propiedad**
   - Propiedad: `SPREADSHEET_ID`
   - Valor: el ID de la planilla (lo que va entre `/d/` y `/edit` en su dirección)
5. Ejecutar una vez la función `probarConfiguracion` desde el editor: tiene que mostrar el nombre de la planilla
6. **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Copiar la URL del deployment

> Si se publica el script sin la propiedad cargada, la app muestra "La app todavía no está configurada" y no lee ni escribe nada.

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

La dirección del Apps Script va en `index.html`, en la constante `DEFAULT_SCRIPT_URL`. No se configura desde la app.

### 4. Clave de acceso

La dirección del Apps Script es pública, así que sin clave cualquiera que la tenga puede leer y escribir.

1. En Apps Script, agregar la propiedad `CLAVE_ACCESO` con la clave elegida (8 caracteres o más), o ejecutar una vez `generarClaveAcceso` para que arme una (aparece en el registro de ejecución). La clave no va en el código.
2. Pasarle la clave a cada persona. La app la pide la primera vez y queda guardada en ese teléfono; si se borran los datos del navegador, la vuelve a pedir.

- No distingue mayúsculas de minúsculas ni cuenta espacios o guiones.
- El servidor la valida en cada lectura y en cada escritura.
- Para cambiarla (se filtró, o alguien ya no tiene que entrar): cambiar el valor de la propiedad. La anterior deja de servir en el acto para todos, y hay que avisarles la nueva a los que siguen.
- Para desactivarla: borrar la propiedad `CLAVE_ACCESO`. Mientras no exista, la app funciona abierta.

### 5. Usuarios

Para que cada persona entre con su nombre y sus movimientos queden firmados.

1. En el editor de Apps Script, ejecutar una vez `crearHojaUsuarios`. Crea la hoja **Usuarios** con las columnas `Nombre | Clave | Activo`.
2. Cargar una fila por persona.
   - **Clave** (optativa): si la persona tiene una, entra con esa. Si está vacía, entra con la clave general (`CLAVE_ACCESO`).
   - **Activo** (optativa): `no` la deja afuera sin borrar la fila.
3. Cada persona abre la app, elige su nombre y escribe su clave. Queda guardado en ese teléfono. Desde el engranaje se puede **Cambiar de persona**.

- Cada movimiento queda con el nombre en la columna **Usuario** de la hoja Movimientos (se agrega sola) y se ve en la pantalla Movim. El nombre lo pone el servidor después de validar la clave.
- Para sacarle el acceso a alguien: borrar su fila o ponerle `no`. Si entraba con la clave general, además hay que cambiarla, porque la sigue sabiendo y podría entrar con el nombre de otro. Con clave propia por persona eso no pasa.
- Mientras la hoja no exista o esté vacía, la app no pide nombre.

### Propiedades del script

| Propiedad | Quién la carga | Para qué |
|---|---|---|
| `SPREADSHEET_ID` | a mano | ID de la planilla |
| `CLAVE_ACCESO` | a mano o con `generarClaveAcceso` | clave general de acceso (optativa) |
| `MOV_COL_USUARIO` | sola | en qué columna de Movimientos va el nombre de quien hizo el movimiento. Se recuerda para no leer el encabezado en cada guardado, y se corrige sola al abrir la pantalla Movim. No hace falta tocarla. |
