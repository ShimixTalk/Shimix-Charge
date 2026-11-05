# Synchronisation privée de Shimix Charge

Le site reste sur GitHub Pages : le stockage existant sur le Mac et l’iPhone est conservé. Le serveur Render stocke des enregistrements chiffrés AES-GCM dans SQLite, sur le disque persistant `/var/data`. Le fichier SQLite et le lien d’association ne doivent jamais être ajoutés au dépôt.

## Activation

1. Appliquer le Blueprint `render.yaml` dans le workspace Render choisi, après validation du coût du service payant et du disque. Les tarifs actuels doivent être confirmés dans Render ; ils ne sont pas codés dans ce dépôt.
2. Attendre le déploiement réussi et vérifier `/health` et la persistance après redémarrage.
3. Reporter l’URL réellement fournie par Render dans `sync-config.js`, puis publier cette branche sur GitHub Pages.
4. Sur l’appareil contenant l’historique principal, activer la synchronisation. Le lien privé permet d’associer l’autre appareil une seule fois. Les historiques locaux existants sont fusionnés ; une copie locale de sécurité est conservée sous la clé `shimix-charge-records-v1-before-sync`.

Ensuite, les modifications se synchronisent après chaque enregistrement, au retour du réseau, au retour dans l’onglet et toutes les 15 secondes tant que le site est ouvert. iOS peut suspendre le site lorsqu’il est fermé : il rattrape les modifications à la réouverture.

Le lien privé donne accès à l’historique : ne pas le publier. Aucune clé de serveur n’est intégrée au site. Le navigateur chiffre les valeurs et authentifie les métadonnées avant l’envoi. L’en-tête d’authentification contient le secret ; utiliser HTTPS et ne pas journaliser les en-têtes. Le serveur ne reçoit pas les factures en clair.

Les suppressions laissent des tombstones chiffrés : une association tardive ne ressuscite pas une recharge supprimée. Pour un même enregistrement modifié sur les deux appareils, la dernière version selon l’horloge logique gagne. Les relevés kilométriques sont identifiés par mois.

Les liens utilisent des secrets aléatoires de 256 bits. Cette première version personnelle limite le stockage à 100 espaces et 32 Mio par espace. Une perte du lien et des données locales empêche la récupération du contenu chiffré ; continuer les exports de sauvegarde habituels. Pour un service public multi-utilisateur, ajouter une inscription authentifiée et des quotas par compte avant d’ouvrir l’inscription à grande échelle.

## Vérification

Node 24 requis. Depuis la racine :

```
node --test --test-isolation=none server/sync.test.mjs
```

Le test démarre un serveur local et simule des appareils indépendants : fusion des historiques, modifications concurrentes, opérations hors connexion, corbeille, restauration, suppression définitive, association tardive, isolation des espaces, refus des requêtes sans authentification et persistance après redémarrage.
