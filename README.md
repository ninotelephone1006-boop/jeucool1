# COMMUNITY WORLD — GitHub Pages + WebSocket

GitHub Pages héberge `index.html`. Le multijoueur passe par le serveur `server.js`.

## 1. Déployer le serveur
Déploie ce dossier sur un hébergeur qui accepte Node.js + WebSocket (par exemple Render, Railway, Fly.io, etc.).

Commande de démarrage :

```bash
npm start
```

Le serveur doit être accessible en HTTPS/WSS, par exemple :

`wss://mon-serveur.example.com`

## 2. Mettre l'URL dans le jeu
Le jeu utilise `wss://jeucool1.onrender.com` par défaut. Pour utiliser un autre serveur, définis `window.COMMUNITY_WORLD_WS` avant le script du jeu dans `index.html` :

```html
<script>window.COMMUNITY_WORLD_WS = 'wss://mon-serveur.example.com';</script>
```

Le serveur doit accepter les connexions WebSocket depuis le site qui héberge `index.html`.

## 2 bis. Physique, caméra et animations « Minecraft Java »

Le joueur n'utilise plus une physique approximative : le moteur de `mc/playerphysics.js`
reproduit **les vrais calculs de Minecraft Java Edition** (déplacements, caméra et
animation des membres), simulés à **20 ticks par seconde** avec rendu interpolé, comme
le jeu original.

### Déplacements (valeurs officielles, 1.21.4)

| Situation | Vitesse | Source |
|---|---|---|
| Marche | **4,317 m/s** | `0,1 b/t` (attribut `movement_speed` 0,1 × 0,98 × 0,91 × 20) |
| Sprint | **5,612 m/s** | attribut ×1,3 (`0,13 b/t`) |
| Accroupi | **1,295 m/s** | facteur d'entrée ×0,3 |
| Saut | **1,252 2 blocs** (10 ticks en l'air) | impulsion `0,42 b/t`, gravité `0,08`, traînée `0,98` |
| Vol créatif | 10,89 m/s (21,78 m/s en sprint) | `flying_speed` 0,05 |

Tout le reste est repris à l'identique :

- **gravité** 0,08 b/t² avec traînée d'air 0,98 (vitesse terminale ≈ 78,4 m/s) ;
- **friction au sol** `slipperiness × 0,91` (0,6 pour la plupart des blocs, 0,98 sur la
  glace, 0,989 sur la glace bleue, 0,8 sur le bloc de slime) ;
- **inertie en l'air** 0,91 b/t, **accélération** 0,1 au sol / 0,02 en l'air ;
- **marche sur les marches** jusqu'à 0,6 bloc (`stepHeight`) ;
- natation, échelles, lianes, blocs rebondissants, dégâts de chute `⌈distance − 3⌉` ;
- sprint impossible en arrière, dans l'eau, en volant ou contre un mur.

### Caméra (première personne)

- hauteur des yeux : **1,62 bloc** debout, **1,27** accroupi, **0,4** en nage/eau ;
- **balancement** synchronisé sur les pas (`limbSwing`, amplitudes 0,5 / 1,0) ;
- **champ de vision dynamique** : ×1,15 en sprint (70° → 80,5°), comme
  `getFOVModifier()` ;
- **inclinaison de la caméra** quand on reçoit un dégât (`hurtCameraEffect`) et
  « yaw de caméra » de 0,1 rad amorti à 40 % par image.

### Animations des membres

`BipedModel.setRotationAngles` : jambes `cos(limbSwing × 0,6662) × 1,4 × amount`,
bras `cos(limbSwing × 0,6662 + π) × 2,0 × amount × 0,5`, `limbSwingAmount` amorti
vers 1 en marchant.

### Touches (comme dans Minecraft)

| Touche | Action |
|---|---|
| `Z Q S D` | se déplacer (`Z` deux fois = sprint maintenu) |
| `Maj` | s'accroupir |
| `Ctrl` | sprinter |
| `Espace` | sauter (2× en créatif = voler) |
| `F3` | écran de débogage (position, vitesse en m/s et b/t, tick, sol, glissance, FOV…) |
| `F5` | 1ʳᵉ / 3ᵉ personne |

Deux réglages (bouton ⚙) permettent de désactiver le balancement de la caméra et le
champ de vision dynamique.

> Les objets non vanilla qui changeaient la physique (jetpack, ressort, grappin,
> potions de vitesse / saut / gravité) ont été supprimés : la physique est 100 % vanilla.

### Vérifier les calculs sans navigateur

```bash
node tools/test-player-physics.mjs   # 51 assertions sur les constantes et le moteur
node tools/test-game-smoke.mjs       # exécute index.html dans Node (stubs) et joue
```

## 3. GitHub Pages
Mets `index.html` à la racine du dépôt GitHub et active GitHub Pages.

Tes amis ouvriront ensuite l'URL GitHub Pages du jeu. Tous les navigateurs se connecteront au même serveur WebSocket.

## 4. La carte ne change plus
Le monde (terrain, objets, textures, objets au sol, heure) est sauvegardé **même quand plus personne n'est connecté** :

- Le serveur écrit la carte dans `world-save.json` (chemin modifiable avec la variable d'environnement `WORLD_SAVE`) : à la déconnexion du dernier joueur, toutes les ~20 s si quelque chose a changé, et à l'arrêt (`SIGTERM`/`SIGINT`). Au démarrage, il recharge ce fichier.
- Chaque navigateur garde en plus une copie de la carte dans `localStorage` (`cw_mirror`) : terrain, objets et, dans la limite de ~3,5 Mo, les textures. Si le serveur repart d'un monde vide (hébergeur gratuit dont le disque est remis à zéro, redémarrage, mise en veille), le premier joueur qui se reconnecte renvoie sa copie : la carte est restaurée à l'identique au lieu de repartir de zéro. Un serveur qui a déjà une carte n'accepte jamais cette restauration, donc rien ne peut l'écraser.

## 5. Objets au sol (clearlags)

Un objet lâché ou cassé **disparaît au bout de 2 minutes** :

- le serveur porte l'échéance (`expireAt`) et envoie un `dropdel` à tout le monde (balayage toutes les 5 s) ; les objets déjà présents dans un ancien `world-save.json` sont nettoyés eux aussi ;
- en mode local (sans serveur), le navigateur fait le même ménage et le partage aux autres onglets ;
- le client retire aussi l'objet de la scène à l'échéance, au cas où un message se perd.

## 6. Modèles 3D

L'import de modèles `.glb` / `.gltf` / `.obj` a été **retiré** du jeu (plus de bouton « Importer un modèle 3D » dans la bibliothèque du mode build). Les modèles déjà présents dans une carte sauvegardée continuent de s'afficher, de pouvoir être déplacés, cassés et reposés : seul le chargement de nouveaux fichiers a disparu.

## 7. Servir le jeu depuis le serveur (optionnel)
`server.js` sert aussi `index.html` sur `/`, avec le WebSocket pointé sur le même hôte : ouvre simplement `http://localhost:10000` (ou l'URL de ton hébergeur). GitHub Pages continue d'utiliser `wss://jeucool1.onrender.com` par défaut.

## 8. Commandes du jeu
- **C** (maintenu) : zoom. En 1re personne, zoom classique au centre de l'écran ; en 3e personne (F5), le zoom se fait sur l'endroit où est le curseur.
- **Molette en maintenant C** : règle la force du zoom (de ×1,2 à ×12, maximum réglable dans PARAMÈTRES).
- **F5** : bascule 1re / 3e personne (sans bras affiché en 1re personne).

## 9. Capes personnalisées

Dans **PERSONNALISER → CRÉER / MODIFIER MA CAPE**, choisis une image (PNG, JPEG, WebP, etc.), glisse-la dans le cadre et règle le zoom pour la recadrer. **Appliquer la cape** l’enregistre en PNG (160 × 256) et la partage aux autres joueurs ; **Télécharger le PNG** exporte le fichier. Le bouton **Retirer la cape** l’efface. La cape reste sur cet appareil pour les prochaines parties.

Une cape se porte dans le dos : l’éditeur affiche sous le recadrage un **aperçu 3D du personnage vu de dos**, qui se met à jour dès qu’une cape est appliquée. Sur l’écran PERSONNALISER, le bouton **🔁 VOIR LA CAPE (FACE / DOS)** retourne l’aperçu principal, et en jeu la touche **F5** (3ᵉ personne) permet de voir sa propre cape.

## 10. Le coffre (comme dans Minecraft)

Le **coffre** est un bloc de **27 emplacements** (3 rangées de 9) :

- **Clic droit** sur un coffre : il s'ouvre. Le couvercle s'anime, le son d'ouverture est joué, et **les autres joueurs voient le couvercle ouvert** tant qu'il reste quelqu'un devant le coffre (il se referme tout seul si le dernier joueur s'éloigne, ferme l'inventaire ou se déconnecte).
- **Le contenu est sauvegardé** : chaque objet reste exactement dans sa case (le serveur écrit le coffre dans `world-save.json`, le navigateur en garde aussi une copie dans `localStorage`). Si deux joueurs ont le coffre ouvert en même temps, les cases se mettent à jour en direct chez tout le monde.
- **Casser un coffre** (ou le supprimer en mode build) fait tomber au sol **le bloc et tout son contenu**, comme dans Minecraft.
- **Fermer un coffre** : Échap, ou s'éloigner de plus de 16 m.
- **Maj + clic** sur une case : transfert rapide de la pile entre le coffre et l'inventaire (dans les deux sens).
- **Obtenir un coffre** : en survie, le bouton **🔨 Fabriquer un coffre** apparaît dans l'inventaire dès que tu as **8 planches** (ou 8 bois) ; en créatif, le coffre est dans la liste d'objets (catégorie **🧱 Blocs**) et dans la bibliothèque du **mode build**.
- Le coffre se pose **sur la grille**, sans rotation, et ne peut pas être posé à l'intérieur d'un joueur ou d'un autre bloc.

## 11. Effets sonores

Les fichiers du dossier `Sounds/` sont utilisés par le jeu :

- `buttonuiclick.mp3` pour les boutons, cases d’inventaire et cartes de l’interface ;
- `Hit.mp3` pour un coup normal en combat ;
- `CriticalHit.mp3` pour un coup critique.

Le réglage **Effets sonores** (et le volume général) contrôle leur niveau. GitHub Pages sert directement les fichiers du dossier ; `server.js` les expose aussi sur `/Sounds/` pour le lancement local ou l’hébergement Node.js.

---

## 12. Blocs Minecraft (nouveau système de blocs)

Tout le système de blocs et d'objets du jeu a été remplacé par **les blocs de
Minecraft** : ce ne sont plus des cubes colorés générés par code, mais les
textures et les formes officielles du jeu, avec leurs vraies propriétés.

- **1 047 blocs** (Minecraft 1.21.4) : pierre, planches, escaliers, dalles,
  vitres, fleurs, minerais, laines, bétons, terres cuites, redstone, coffres,
  fourneaux, fanaux, champignons, coraux… avec leurs **noms français officiels**.
- **Textures officielles** : les 1 039 fichiers PNG 16×16 sont dans
  `textures/minecraft/blocks/`, et regroupés dans une **feuille de textures**
  `textures/minecraft/atlas.png` (792 tuiles) chargée en une seule image par le jeu.
- **Propriétés réelles** de chaque bloc : solide ou traversable, **émission de
  lumière** (0-15), dureté, résistance, outil efficace, et sa **forme exacte**
  (dalle = demi-bloc, escalier = deux pavés, barrière = poteau, torche, fleur en croix…).

### Inventaire créatif (touche E, mode créatif)
Les blocs sont rangés par onglets, comme dans Minecraft :

| Onglet | Blocs |
|---|---|
| 🧱 Blocs de construction | 178 |
| 🌿 Blocs naturels | 234 |
| 🪨 Pierres & Minerais | 169 |
| 🪴 Décorations | 185 |
| 🔴 Redstone & Mécanismes | 66 |
| 🎨 Laine, Béton & Couleurs | 145 |
| 🧰 Fonctionnel | 54 |
| ✨ Spéciaux | 16 |

Chaque case affiche maintenant une **vignette isométrique 3D** du vrai modèle Minecraft (dessus et côtés visibles), texturée depuis l’atlas officiel : on ne voit plus seulement la face avant du bloc. Les vignettes sont calculées et mises en cache à la demande, puis réutilisées dans l’inventaire, la barre rapide et les onglets créatifs. Le nom français et l’infobulle avec les propriétés restent disponibles.

- **Clic** : la pile part dans l'inventaire.
- **Clic droit** : le bloc est **équipé directement dans la barre d'accès rapide**
  (touches 1 à 9) et apparaît **en main** en 3D.
- Le champ 🔎 cherche dans **tous** les blocs (français ou identifiant Minecraft).

L’interface reprend aussi les **textures d’interface Minecraft Java 1.21.4** : fond de l’inventaire de survie, panneau créatif, cases, barre rapide et sélection, ainsi que les boutons normaux / survolés des menus. Les PNG d’interface sont rangés dans `textures/minecraft/gui/` (source indiquée dans `textures/minecraft/gui/SOURCES.md`).

### Pose dans le monde
- **Clic droit** pose le bloc sur la grille, exactement à l'endroit visé
  (le dessus du bloc, ou la face latérale si tu vises un côté).
- **Orientation comme dans Minecraft** : four, distributeur, coffre, citrouille…
  se tournent **vers toi** ; escaliers, pistons, répéteurs et observateurs
  s'orientent dans **l'axe de ton regard** ; les bûches, piliers et blocs à axe
  (basalte, quartz, chaînes…) se **couchent dans l'axe de la face visée**.
- **Casse** : le temps de casse suit la dureté officielle du bloc et l'outil tenu
  (pioche, hache, pelle, houe) ; en créatif, un clic suffit.
- **Collision** : chaque bloc utilise sa vraie boîte (on monte sur une dalle,
  on passe sous une barrière) ; fleurs, torches et eau sont traversables.
- **Torches, fanaux, lave, champignons lumineux…** éclairent réellement le monde.
- Les **objets au sol** affichent la vignette du bloc, et l'eau/lave/glace/verre
  teinté sont translucides.

### Anciens blocs
Les blocs de l'ancienne version (pierre_lisse, planche_chêne, laine_rouge, …) sont
**conservés en alias** : une carte déjà sauvegardée s'affiche avec le bloc
Minecraft équivalent au lieu de disparaître. De même, les objets « planche »,
« pierre », « bois »… de l'ancien inventaire deviennent des blocs Minecraft.

### Régénérer les données de blocs (optionnel)
```bash
npm run fetch:mcdata   # télécharge textures + modèles + traductions Minecraft
npm run build:blocks   # reconstruit l'atlas, mc/blocks.js et l'atlas du terrain
npm test               # vérifie les 1 047 blocs (données, atlas, géométrie)
npm run preview:blocks # planche d'aperçu de 145 blocs emblématiques
```

Fichiers concernés : `mc/blocks.js` (données des blocs), `mc/geom.js`
(géométrie et orientation, partagée avec les outils), `textures/minecraft/`
(textures), `tools/build-mc-blocks.mjs` (générateur), `tools/test-*.mjs` (tests).
Le sol du monde utilise lui aussi les textures Minecraft
(`textures/minecraft/terrain-atlas.png` : herbe, terre, sable, pierre, boue,
neige, béton, calcaire), teinté par biome comme dans le jeu.
Le serveur (`server.js`) sert aussi ces fichiers, donc le jeu fonctionne en
local (`npm start`) comme sur GitHub Pages.
