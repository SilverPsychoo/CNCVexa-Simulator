# FANUC Forge Studio v5.5

Simulador educativo CNC para fresadora y torno con editor, macros, ciclos, herramientas y visualización 2D/3D.

## Correcciones de v5.5

Esta versión corrige la lógica del perfil de torno en `G71/G70`:

- Los bloques definidos por `P` y `Q` ya no vuelven a ejecutarse como movimientos normales cuando están escritos inmediatamente después del ciclo.
- `G71` interpreta `U` del primer bloque como profundidad radial y reduce el diámetro en el doble de ese valor.
- Los radios en `G18` se calculan en el plano físico Z–radio.
- `X` continúa programándose como diámetro, mientras que `I` se interpreta como distancia radial al centro del arco.
- Los bloques `G02/G03` dentro del perfil P–Q conservan la curvatura; ya no se convierten en líneas rectas.
- `G70` recorre el perfil completo y regresa al punto guardado al finalizar.
- Se eliminó la falsa advertencia `RAPID_STOCK` que aparecía al ejecutar nuevamente los bloques P–Q después de `G71`.

Se incluye el ejemplo `samples/g71_radios_ik_v55.nc` y su proyecto `.ffcnc`.

## Funciones principales

### Fresa

- Mesa y pieza configurables.
- Sistemas G54–G59.
- Unidades métricas e imperiales.
- Herramientas métricas, imperiales y personalizadas.
- Coordenadas polares G15/G16.
- Rotación G68/G69.
- Ciclos de barrenado.
- Custom Macro, variables, IF/GOTO y WHILE.
- Simulación 2D y 3D.

### Torno

- Barra maciza o tubular.
- Plato, mordazas y torreta.
- Perfil X–Z y modelo 3D por revolución.
- Herramientas exteriores, interiores, de ranurado, roscado y barrenado.
- G70, G71, G72, G73, G74, G75, G76 y G83.
- G96/G97 y G94/G95.
- Compensación G40/G41/G42 aproximada.
- Detección preventiva de colisiones.

## Ejecutar localmente

En Windows abre:

```text
start_windows.bat
```

La v5.5 busca el puerto `8093` o el siguiente disponible.

## Aviso

FANUC Forge es una herramienta educativa. Antes de ejecutar un programa en una máquina real deben verificarse herramientas, offsets, sujeción, límites, compensaciones, *single block* y *dry run*.
