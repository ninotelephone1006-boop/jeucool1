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
- Chaque navigateur garde en plus une copie de la carte dans `localStorage` (`cw_mirror`) : terrain, objets et, dans la limite de ~3,5 Mo, les textures/modèles importés. Si le serveur repart d'un monde vide (hébergeur gratuit dont le disque est remis à zéro, redémarrage, mise en veille), le premier joueur qui se reconnecte renvoie sa copie : la carte est restaurée à l'identique au lieu de repartir de zéro. Un serveur qui a déjà une carte n'accepte jamais cette restauration, donc rien ne peut l'écraser.

## 5. Importer des modèles 3D

Les fichiers `.glb`, `.gltf` et `.obj` peuvent peser jusqu’à **100 Mo par modèle**. Le serveur autorise la taille WebSocket nécessaire au transfert de ces fichiers (encodés en base64). Pour conserver les gros modèles après un redémarrage, l’hébergeur doit préserver le fichier `world-save.json` ; la copie de secours dans le navigateur reste volontairement limitée à environ 3,5 Mo.

## 6. Servir le jeu depuis le serveur (optionnel)
`server.js` sert aussi `index.html` sur `/`, avec le WebSocket pointé sur le même hôte : ouvre simplement `http://localhost:10000` (ou l'URL de ton hébergeur). GitHub Pages continue d'utiliser `wss://jeucool1.onrender.com` par défaut.

## 7. Commandes du jeu
- **C** (maintenu) : zoom. En 1re personne, zoom classique au centre de l'écran ; en 3e personne (F5), le zoom se fait sur l'endroit où est le curseur.
- **Molette en maintenant C** : règle la force du zoom (de ×1,2 à ×12, maximum réglable dans PARAMÈTRES).
- **F5** : bascule 1re / 3e personne.
