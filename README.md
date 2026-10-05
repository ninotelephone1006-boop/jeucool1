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

## 3. GitHub Pages
Mets `index.html` à la racine du dépôt GitHub et active GitHub Pages.

Tes amis ouvriront ensuite l'URL GitHub Pages du jeu. Tous les navigateurs se connecteront au même serveur WebSocket.

## 4. La carte ne change plus
Le monde (terrain, objets, textures, objets au sol, heure) est sauvegardé **même quand plus personne n'est connecté** :

- Le serveur écrit la carte dans `world-save.json` (chemin modifiable avec la variable d'environnement `WORLD_SAVE`) : à la déconnexion du dernier joueur, toutes les ~20 s si quelque chose a changé, et à l'arrêt (`SIGTERM`/`SIGINT`). Au démarrage, il recharge ce fichier.
- La commande **`/clear map`** (voir § 9) remet la carte par défaut. Le serveur garde la date de cette remise à zéro : une copie de navigateur plus ancienne n'est plus restaurée (le joueur reçoit un message l'expliquant), donc une carte effacée ne peut pas revenir toute seule.
- Chaque navigateur garde en plus une copie de la carte dans `localStorage` (`cw_mirror`) : terrain, objets et, dans la limite de ~3,5 Mo, les textures. Si le serveur repart d'un monde vide (hébergeur gratuit dont le disque est remis à zéro, redémarrage, mise en veille), le premier joueur qui se reconnecte renvoie sa copie : la carte est restaurée à l'identique au lieu de repartir de zéro. Un serveur qui a déjà une carte n'accepte jamais cette restauration, donc rien ne peut l'écraser.

## 5. Objets au sol (clearlags)

Un objet lâché ou cassé **disparaît au bout de 2 minutes** :

- le serveur porte l'échéance (`expireAt`) et envoie un `dropdel` à tout le monde (balayage toutes les 5 s) ; les objets déjà présents dans un ancien `world-save.json` sont nettoyés eux aussi ;
- en mode local (sans serveur), le navigateur fait le même ménage et le partage aux autres onglets ;
- le client retire aussi l'objet de la scène à l'échéance, au cas où un message se perd.

## 6. Modèles 3D

L'import de modèles `.glb` / `.gltf` / `.obj` a été **retiré** du jeu (plus de bouton « Importer un modèle 3D » dans la bibliothèque du mode build). Les modèles déjà présents dans une carte sauvegardée continuent de s'afficher, de pouvoir être déplacés, cassés et reposés : seul le chargement de nouveaux fichiers a disparu.

## 7. Tableaux et images PNG
- **Objet « Tableau »** (bibliothèque du mode build, catégorie « Déco ») : il se pose **uniquement à la verticale, sur le côté d'un bloc**. Avec l'outil « Pose », un 1er clic choisit le premier coin sur le mur, un 2e clic le coin opposé (des lignes montrent le contour ; **R** refait les coins, clic droit annule), un 3e clic gauche pose le tableau. Sa taille se règle dans le panneau de propriétés (0,5 à 16 blocs par côté).
- **Objet « PNG »** (inventaire créatif, comme le CD) : clic droit en le tenant → choisis une image (PNG, JPEG, WebP, GIF ou BMP, ≤ 20 Mo, réduite à 1024 px max). Clic droit avec cet objet PNG sur un tableau : l'image s'affiche dessus. **Maj + clic droit** sur le tableau adapte sa taille aux proportions de l'image. Dans le panneau de propriétés d'un tableau : « Choisir un PNG », « Ajuster à l'image », « Enlever l'image ».
- L'image choisie est envoyée aux autres joueurs par le serveur (elle est sauvegardée avec la carte, comme les autres textures).

## 8. Servir le jeu depuis le serveur (optionnel)
`server.js` sert aussi `index.html` sur `/`, avec le WebSocket pointé sur le même hôte : ouvre simplement `http://localhost:10000` (ou l'URL de ton hébergeur). GitHub Pages continue d'utiliser `wss://jeucool1.onrender.com` par défaut.

## 9. Commandes du jeu
- **/build** : ouvre/ferme la bibliothèque du mode build (objets, blocs, décoration).
- **/clear map** : remet la carte par défaut pour tout le monde (terrain plat, plus aucun objet, texture ni objet au sol).
- **C** (maintenu) : zoom. En 1re personne, zoom classique au centre de l'écran ; en 3e personne (F5), le zoom se fait sur l'endroit où est le curseur.
- **Molette en maintenant C** : règle la force du zoom (de ×1,2 à ×12, maximum réglable dans PARAMÈTRES).
- **F5** : bascule 1re / 3e personne.
