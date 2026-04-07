# Gestión Camisetas del Club

Webapp para controlar los pedidos y retiros de camisetas del club.

## Funcionalidades

- 3 tabs: **Camiseta Blanca**, **Camiseta Azul** y **Todos**
- Búsqueda por nombre
- Marcar retiros con monto pagado, medio de pago y observaciones
- Sincronización con Google Sheets para uso compartido
- Backup local en el navegador

## Setup rápido

### 1. Subir a GitHub

```bash
cd camisetas-club-app
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU_USUARIO/camisetas-club.git
git push -u origin main
```

Luego ir a **Settings > Pages > Source: main branch** para activar GitHub Pages.

### 2. Configurar Google Sheets (para sincronización)

1. Crear un Google Sheet nuevo (puede estar vacío)
2. Copiar el **ID** del spreadsheet de la URL: `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`
3. Ir a [script.google.com](https://script.google.com) y crear un nuevo proyecto
4. Pegar el contenido de `google-apps-script.js`
5. Reemplazar `TU_SPREADSHEET_ID_ACA` con el ID copiado en el paso 2
6. Ir a **Deploy > New deployment**
   - Tipo: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Copiar la URL del deployment
8. En la webapp, pegar esa URL en el panel de configuración

## Uso sin Google Sheets

La app funciona también sin Google Sheets usando solo almacenamiento local del navegador, pero los datos no se sincronizan entre dispositivos.
