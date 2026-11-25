# Plantillas de correo de Supabase Auth

Plantillas de los correos que envía Supabase Auth para Patrullan2. No se aplican solas: hay que pegarlas a mano en el panel de cada proyecto (`patrullan2-dev` y, más adelante, el de producción).

| Archivo | Para qué sirve |
|---|---|
| `confirmacion.html` | Cuerpo del correo «Confirm sign up» (HTML con estilos en línea, sin imágenes ni hojas externas). |
| `confirmacion.txt` | Mismo contenido en texto plano, de referencia o para un SMTP propio que pida versión de texto. |

## Correo de confirmación de registro

1. Abre el proyecto en el panel de Supabase.
2. Ve a **Authentication → Emails → Templates → Confirm sign up**.
3. En **Subject** escribe:

   ```
   Confirma tu cuenta en Patrullan2
   ```

4. En **Message body** (pestaña de código/HTML) borra el contenido y pega **todo** `confirmacion.html`.
5. Comprueba que el enlace usa la variable `{{ .ConfirmationURL }}` (aparece tres veces: en el botón y, en el enlace de texto, como destino y como texto visible). No la cambies: Supabase la sustituye por el enlace de confirmación, que ya incluye el `redirect_to` a `online/confirmado.html` que manda la app.
6. Pulsa **Save changes**.
7. Prueba: crea una cuenta desde «Jugar online / Cuenta» con un correo real tuyo y revisa el correo en el móvil y en el ordenador.

El panel solo tiene un campo de cuerpo (HTML). El texto plano (`confirmacion.txt`) no se pega en Supabase; sirve de referencia o para un proveedor SMTP propio que lo pida.

## Notas

- El texto dice que el enlace «caduca pasado un tiempo» sin dar la cifra, porque depende de **Authentication → Providers → Email → Email OTP Expiration** (por defecto, 24 horas). Si fijas un valor y quieres mostrarlo, cámbialo en los dos archivos.
- El servidor de correo integrado de Supabase tiene un límite de envíos muy bajo y es solo para pruebas. Para producción conviene configurar un SMTP propio (Authentication → Emails → SMTP Settings).
- No usar escudos, logotipos ni nombres de la Policía Municipal de Madrid ni del Ayuntamiento: Patrullan2 es una aplicación independiente.
