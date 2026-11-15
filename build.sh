#!/bin/bash
# Gera game.js (jogo inteiro num arquivo) e jogo-do-mundo.html (versão em arquivo único).
# Uso: npm install && ./build.sh     (precisa de esbuild e three em node_modules)
set -e
cd "$(dirname "$0")"
NM="${NM:-$PWD/node_modules}"
ESBUILD="${ESBUILD:-npx esbuild}"
$ESBUILD src/app.js --bundle --format=esm --external:three --minify --outfile=game.js \
  "--alias:three/addons/loaders/GLTFLoader.js=$NM/three/examples/jsm/loaders/GLTFLoader.js" \
  --loader:.html=text --loader:.css=text --log-level=warning
python3 - <<'PY'
import hashlib, re
js = open('game.js').read()
v = hashlib.sha1(js.encode()).hexdigest()[:10]
m = open('src/main.js').read()
m = re.sub(r"game\.js\?v=[A-Za-z0-9]+", "game.js?v=" + v, m)
open('src/main.js', 'w').write(m)
shell = open('index.html').read()
tag = '<script type="module" src="src/main.js"></script>'
assert tag in shell
single = shell.replace(tag, '<script type="module">\n' + js.replace('</script', '<\\/script') + '\n</script>')
open('jogo-do-mundo.html', 'w').write(single)
print('game.js', len(js), 'bytes, versão', v)
PY
