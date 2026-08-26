# CNCVexa Simulator

**CNCVexa Simulator** es un simulador CNC educativo para **fresadora y torno** que funciona directamente en el navegador. Incluye editor de código CNC, herramientas, offsets, ciclos, macros y visualización 2D/3D.

> Versión actual: **5.6**

## Funciones principales

### Fresadora

- Mesa y pieza configurables.
- Sistemas de trabajo G54–G59.
- Unidades métricas e imperiales.
- Biblioteca de herramientas métricas, imperiales y personalizadas.
- Coordenadas polares G15/G16.
- Rotación G68/G69.
- Ciclos de barrenado.
- Variables, IF/GOTO, WHILE y llamadas de subprogramas.
- Simulación de trayectoria 2D y remoción de material 3D.

### Torno

- Barra maciza o tubular.
- Plato, mordazas y torreta.
- Perfil X–Z y modelo 3D por revolución.
- Herramientas exteriores, interiores, de ranurado, roscado y barrenado.
- Ciclos G70, G71, G72, G73, G74, G75, G76 y G83.
- G96/G97 y G94/G95.
- Compensación G40/G41/G42 aproximada.
- Detección preventiva de colisiones.

## Pantalla de inicio

Al abrir CNCVexa Simulator puedes elegir entre:

- Nuevo proyecto de fresa.
- Nuevo proyecto de torno.
- Abrir código de fresa.
- Abrir código de torno.
- Abrir proyecto de fresa.
- Abrir proyecto de torno.

La pantalla principal contiene un espacio separado para publicidad. El área de simulación no contiene anuncios.

## Archivos

Los programas CNC pueden abrirse y guardarse como:

```text
.nc
.tap
.txt
.cnc
.gcode
```

Los proyectos completos de CNCVexa utilizan:

```text
.cncvexa
```

El nombre del programa puede cambiarse directamente haciendo clic sobre el nombre mostrado arriba del editor.

## Publicación en GitHub Pages

Nombre recomendado del repositorio:

```text
CNCVexa-Simulator
```

URL prevista:

```text
https://silverpsychoo.github.io/CNCVexa-Simulator/
```

El proyecto incluye `robots.txt`, `sitemap.xml`, metadatos de descripción, Open Graph y datos estructurados para facilitar la indexación de la página pública.

## Ejemplos incluidos

La carpeta `samples/` contiene programas CNC y proyectos `.cncvexa` de ejemplo para fresadora y torno.

## Seguridad

CNCVexa Simulator es una herramienta educativa. Antes de ejecutar un programa en una máquina real deben verificarse herramientas, offsets, sujeción, límites de carrera, compensaciones, *single block* y *dry run*.

## Autor

Desarrollado por **SilverPsycho**.
