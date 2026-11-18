# ONDA — surf em primeira pessoa

Protótipo jogável em WebGL (Three.js). Você surfa em primeira pessoa numa onda procedural que forma tubo de verdade:
a água é o herói, os joelhos dobram na hora do drop e do bottom turn, a mão arrasta na parede.

## Rodar
```bash
npm install
node build.mjs        # gera dist/index.html (arquivo único, abre direto no navegador)
```
Abra `dist/index.html`. Clique em **Entrar no mar**.

## Controles
| Tecla | Ação |
|---|---|
| Mouse ou A / D | Carvar (direita = subir a parede) |
| A / D alternados | Remar (mais braçadas = takeoff mais rápido) |
| Espaço | Levantar na remada · pulo/aéreo na parede |
| W | Bombear (ganha velocidade) |
| S | Arrastar a mão e segurar o tubo |
| Shift | Agachar (tuck) |
| A / D no ar | Girar (180°, 360°…) · Q = pegar a borda |
| Alt + mouse | Olhar em volta |
| N / R / B / V | Próximo mar / nova onda / modo cinema / câmera lateral |

## Como a onda funciona
A face é um arco de círculo com centro em `(0, Rf)`. O parâmetro de curl `k` fecha o arco de ~55° (onda aberta) até 250° (tubo).
O ponto de quebra (peel) corre ao longo da crista; o surfista precisa acompanhá-lo. Ver `src/wave.js` (geometria) e `src/game.js` (física).

## Ambientes
Ilha Verde · Hora Dourada · Tempestade · Orla Urbana · Noite Lunar (`src/envs.js`).

## Fluidez
Carve com inércia, ganho de velocidade em curvas fundas, medidor de bolso (BOLSO) e empuxo da onda que mantém você no ponto de quebra; S segura o tubo.
