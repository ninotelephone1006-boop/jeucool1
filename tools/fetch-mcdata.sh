#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Télécharge les données sources Minecraft utilisées par tools/build-mc-blocks.mjs
# (textures des blocs + modèles + propriétés + noms français).
#
#   bash tools/fetch-mcdata.sh
#
# Tout est écrit dans tools/mcdata/ (non versionné : ces fichiers appartiennent
# à Mojang / aux dépôts publics qui les miroitent).
#
# Sources :
#   * textures + modèles + états de blocs  -> paquet npm `minecraft-assets`
#     (PrismarineJS, miroir des ressources du client Minecraft 1.21.4)
#   * propriétés (solidité, lumière, dureté, outil) -> paquet npm `minecraft-data`
#   * noms français officiels -> dépôt GitHub `InventivetalentDev/minecraft-assets`
# ---------------------------------------------------------------------------
set -euo pipefail

VERSION="${MC_VERSION:-1.21.4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/tools/mcdata"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DATA/textures"

echo "→ minecraft-assets ($VERSION)…"
( cd "$TMP" && npm pack minecraft-assets >/dev/null )
tar xzf "$TMP"/minecraft-assets-*.tgz -C "$TMP"
SRC="$TMP/package/minecraft-assets/data/$VERSION"

cp "$SRC/blocks_models.json"   "$DATA/"
cp "$SRC/blocks_states.json"   "$DATA/"
cp "$SRC/blocks_textures.json" "$DATA/"
cp "$SRC"/blocks/*.png         "$DATA/textures/"

echo "→ minecraft-data ($VERSION)…"
( cd "$TMP" && npm pack minecraft-data >/dev/null )
tar xzf "$TMP"/minecraft-data-*.tgz -C "$TMP" "package/minecraft-data/data/pc/$VERSION/blocks.json"
cp "$TMP/package/minecraft-data/data/pc/$VERSION/blocks.json" "$DATA/mcdata_blocks.json"

echo "→ noms français / anglais officiels…"
for L in fr_fr en_us; do
  if command -v gh >/dev/null 2>&1; then
    gh api "repos/InventivetalentDev/minecraft-assets/contents/assets/minecraft/lang/$L.json?ref=$VERSION" -q .content \
      | base64 -d > "$DATA/$L.json"
  else
    curl -sSL "https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/$VERSION/assets/minecraft/lang/$L.json" \
      -o "$DATA/$L.json"
  fi
done

echo
echo "✅ Données prêtes dans tools/mcdata/ ($(ls "$DATA/textures" | wc -l) textures)"
echo "   Lance maintenant :  node tools/build-mc-blocks.mjs"
