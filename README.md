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
