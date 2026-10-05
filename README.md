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
