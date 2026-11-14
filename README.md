# Jogo do Mundo 🌍

Simulador de voo pela Terra inteira, direto no navegador (celular ou computador).
Voe de wingsuit sobre **qualquer lugar do planeta** com **relevo real**, **imagens de satélite**,
**clima ao vivo**, **estações do ano** e **hora do dia** — acelere até quebrar a barreira do som
ou suba até a órbita e veja a curvatura da Terra.

## Como jogar

Abra o `index.html` por um servidor web (veja abaixo), escolha um lugar ou busque qualquer endereço do mundo.

O **analógico** (ou `WASD`) escolhe a direção do movimento, relativa à câmera. O **outro lado da tela** (ou o mouse / as setas) gira a visão. Voando, você vai para onde olha.

| Ação | Teclado | Celular |
|---|---|---|
| Mover (andar, nadar, voar) | `W` `A` `S` `D` | analógico (lado esquerdo) |
| Girar a visão | mouse (clique na tela) / setas | arrastar o lado direito (pode ser por cima dos botões) |
| Turbo no ar · correr no chão · nadar rápido | `Shift` | botão **TURBO / CORRER** |
| Escolher o boost (Passeio, Rápido, Supersônico, Hipersônico, Orbital, Máximo) | `1`–`6` | botão **BOOST** |
| Decolar / pousar | `F` | botão **VOAR / POUSAR** |
| Pular (no chão) · frear (voando) | `Espaço` · `S` | botão **PULAR / FREIO** |
| Subir / descer pairando | `Espaço` / `Q` | olhar para cima/baixo e empurrar o analógico |
| Planar de wingsuit | `X` | botão **PLANAR** |
| Acenar | `G` | botão **ACENAR** |
| Trocar câmera | `C` | botão do olho |
| Tirar foto | `P` | botão da câmera |
| Percurso de anéis | `R` | menu → Desafios |
| Abrir o mapa | menu → Mapa | toque no minimapa |
| Menu (lugares, mapa, desafios, personagem, ajustes) | `M` / `Esc` | botão ☰ |

## O que tem

- **Personagem articulado** com animações de movimento real (parado, andando, correndo) e poses de voo, turbo, pairar, planar de wingsuit, nadar, pular, cair, pousar e acenar. Cores personalizáveis.
- **Andar, correr, pular e nadar pelo mundo**: colisão com as casas (dá para pousar e andar nos telhados), nado automático em mar, lagos e rios.
- **Casas e prédios 3D do mundo inteiro** (Overture Maps: OpenStreetMap + contornos detectados por satélite por Google e Microsoft), com telhados de duas águas e a cor que têm na foto de satélite — inclusive em cidades pequenas.
- **Terreno real do planeta inteiro**: elevação Terrain Tiles (AWS/Mapzen) em quadtree com nível de detalhe, sobre uma esfera com o raio da Terra (curvatura real, horizonte, vista da órbita).
- **Imagens de satélite** (Esri World Imagery ou Sentinel-2 cloudless) até ~1 m/pixel.
- **Mundo real do OpenStreetMap** (OpenFreeMap): **casas e prédios 3D** com telhados e janelas que acendem à noite, **lagos, rios e canais** com água refletindo o céu, e **nomes de bairros, cidades, picos e lagos** flutuando sobre o cenário.
- **Ruas, estradas, pontes e trilhos em 3D**, com asfalto e faixas pintadas, acompanhando o relevo.
- **Monumentos famosos** modelados nas coordenadas reais: Cristo Redentor, Torre Eiffel, Estátua da Liberdade, Big Ben, London Eye, Burj Khalifa, Pirâmides de Gizé, Taj Mahal, Empire State, CN Tower, Tokyo Skytree, Monumento a Washington e Gateway Arch.
- **Desafios**: percurso de 12 anéis contra o relógio (`R`), corridas até as cidades reais ao redor, destino marcado no mapa com feixe de luz, recordes (velocidade, altitude, distância) e monumentos para descobrir.
- **Minimapa e mapa-múndi**: toque no minimapa para abrir o mapa, arraste e aproxime, escolha um ponto e voe para lá ou marque como destino.
- **Fotos** (`P` ou botão da câmera): salva a imagem do voo com a legenda do lugar.
- **Favoritos**: salve lugares para voltar depois.
- **Personagem**: cores do traje, dos detalhes, do capacete e do rastro de vapor.
- **Florestas 3D** geradas onde a imagem de satélite mostra mata (pinheiros nas regiões frias, copas arredondadas nas quentes).
- **Céu físico** (espalhamento Rayleigh + Mie): nascer/pôr do sol, crepúsculo, estrelas, céu negro e borda azul da atmosfera no espaço; neblina atmosférica real à distância.
- **Sol na posição astronômica real** para a hora, a data e o lugar; luzes das cidades à noite vistas do espaço (NASA Black Marble).
- **Clima ao vivo** (Open-Meteo): nuvens, chuva, neve, neblina, vento, trovoadas com raios, temperatura no solo e no ar (cai com a altitude). O clima **acompanha o relógio do jogo** pela previsão hora a hora: acelere o tempo e veja o tempo mudar — ou escolha o clima no menu.
- **Estações do ano**: linha de neve pela latitude/altitude/época, neve real quando o clima indica, folhas de outono, vegetação de inverno.
- **Física de voo arcade**: pairar, mergulhar, turbo exponencial, planeio de wingsuit, pouso, andar, correr e pular; colisão com o relevo e a água.
- **Efeitos**: estrondo e anel da barreira do som, cone de vapor e onda de choque supersônica, rastros de vapor nas mãos, spray de neve/água/poeira rente ao chão, desfoque de velocidade, tremor de câmera e som procedural (vento, turbo, estrondo, trovão).
- **HUD**: nome do lugar ao vivo, coordenadas, altitude, velocidade em km/h e número Mach, bússola, hora local, estação e clima.

## Publicar (GitHub Pages)

É um site estático, sem build. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**,
escolha a branch e a pasta `/ (root)`. O jogo fica em `https://<usuário>.github.io/Jogo-do-mundo/`.

Para testar localmente: `python3 -m http.server` na pasta e abra `http://localhost:8000`.

## Créditos dos dados

Relevo: Terrain Tiles (Mapzen / AWS Open Data) · Imagens: Esri, Maxar, Earthstar Geographics / Sentinel-2 cloudless © EOX (Copernicus) ·
Luzes noturnas: NASA Black Marble (GIBS) · Clima: Open-Meteo · Nomes de lugares, prédios e água: © colaboradores do OpenStreetMap (OpenFreeMap / OpenMapTiles, Nominatim) ·
Prédios: Overture Maps Foundation (OpenStreetMap, Google Open Buildings, Microsoft) · Personagem: modelo X Bot (Mixamo), dos exemplos do three.js · Motor 3D: three.js.
