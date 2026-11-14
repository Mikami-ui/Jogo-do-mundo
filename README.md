# Jogo do Mundo 🌍

Simulador de voo pela Terra inteira, direto no navegador (celular ou computador).
Voe de wingsuit sobre **qualquer lugar do planeta** com **relevo real**, **imagens de satélite**,
**clima ao vivo**, **estações do ano** e **hora do dia** — acelere até quebrar a barreira do som
ou suba até a órbita e veja a curvatura da Terra.

## Como jogar

Abra o `index.html` por um servidor web (veja abaixo), escolha um lugar ou busque qualquer endereço do mundo.

| Ação | Teclado | Celular |
|---|---|---|
| Turbo (acelera sem limite: Mach 1, 2, 3… órbita) | `W` / `Shift` | botão **TURBO** |
| Frear até parar (pairar) | `S` | botão **FREIO** |
| Soltar o voo (planar de wingsuit) / voltar a voar | `X` | botão **SOLTAR / VOAR** |
| Virar | `←` `→` / `A` `D` | joystick (lado esquerdo) |
| Subir / descer | `↑` `↓` / mouse (clique na tela) | joystick |
| Pular / andar no chão | `Espaço` / `↑` | joystick |
| Trocar câmera | `C` | botão 📷 |
| Olhar ao redor | — | arrastar o lado direito |
| Menu (lugares, hora, estação, clima, qualidade) | `M` / `Esc` | botão ☰ |
| Avançar 1 hora | `T` | menu → Ajustes |

## O que tem

- **Terreno real do planeta inteiro**: elevação Terrain Tiles (AWS/Mapzen) em quadtree com nível de detalhe, sobre uma esfera com o raio da Terra (curvatura real, horizonte, vista da órbita).
- **Imagens de satélite** (Esri World Imagery ou Sentinel-2 cloudless) até ~1 m/pixel.
- **Florestas 3D** geradas onde a imagem de satélite mostra mata, e **prédios 3D** do OpenStreetMap sobre o relevo.
- **Céu físico** (espalhamento Rayleigh + Mie): nascer/pôr do sol, crepúsculo, estrelas, céu negro e borda azul da atmosfera no espaço; neblina atmosférica real à distância.
- **Sol na posição astronômica real** para a hora, a data e o lugar; luzes das cidades à noite vistas do espaço (NASA Black Marble).
- **Clima ao vivo** (Open-Meteo): nuvens, chuva, neve, neblina, vento, trovoadas com raios — ou escolha o clima no menu.
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
Luzes noturnas: NASA Black Marble (GIBS) · Clima: Open-Meteo · Nomes de lugares e prédios: © colaboradores do OpenStreetMap (Nominatim / Overpass) ·
Motor 3D: three.js.
