# FANUC Forge Studio v5.7

Simulador educativo CNC para fresadora y torno con editor, macros, ciclos, herramientas y visualización 2D/3D.

## Cambios de v5.7

Esta versión amplía el modo torno para cubrir las prácticas 24–33 y agrega soporte de `G84` axial. También conserva y extiende la corrección del ciclo frontal `G72`:

- Las pasadas de desbaste se realizan paralelas al eje X.
- La secuencia de pasadas sigue el sentido definido por el perfil P–Q.
- En perfiles escritos desde Z negativo hacia Z0, las pasadas avanzan visualmente de izquierda a derecha.
- El primer bloque P con movimiento únicamente en Z se usa como aproximación A→A′ y no como parte del contorno terminado.
- Cada posición Z obtiene su diámetro mediante intersección con el perfil, incluyendo arcos discretizados.
- La retirada `R` se representa en sentido contrario al avance axial.
- Los bloques P–Q no vuelven a ejecutarse fuera del ciclo.
- `G72` Tipo II acepta perfiles con cambios de dirección en X.
- `G84` simula entrada y salida sincronizada del machuelo sobre Z.
- Se incluyen programas de prueba para las prácticas 24 a 33.

También se conserva la corrección de v5.5 para `G71/G70`, programación de X en diámetro y arcos `I/K` en el plano físico Z–radio.

Se incluye el ejemplo:

```text
samples/g72_izquierda_derecha_v56.nc
samples/g72_izquierda_derecha_v56.ffcnc
```

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
- G70, G71, G72, G73, G74, G75, G76, G83 y G84.
- G96/G97 y G94/G95.
- Compensación G40/G41/G42 aproximada.
- Detección preventiva de colisiones.

## Ejecutar localmente

En Windows abre:

```text
start_windows.bat
```

La v5.7 busca el puerto `8095` o el siguiente disponible.

## Aviso

FANUC Forge es una herramienta educativa. Antes de ejecutar un programa en una máquina real deben verificarse herramientas, offsets, sujeción, límites, compensaciones, *single block* y *dry run*.
