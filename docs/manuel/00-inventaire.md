# Inventaire des fonctions de LIM2 — checklist pour le manuel

*Relevé le 19/08/2026 par analyse du code. À relire AVANT que j'écrive le manuel :
si un pan entier manque ici, il manquera dans le manuel.*

**Légende**
`✅` traité par le manuel actuel · `⚠️` traité mais **périmé** · `🆕` **absent** du manuel actuel
`❓` je ne suis pas sûr de mon interprétation — à trancher par toi

---

## 0. Constat sur le manuel actuel

- PDF de 26 pages, daté du **31/05/2026**, 9 chapitres.
- Publié via l'éditeur, servi depuis `lim-logs/documents/manuel-utilisateur.pdf`,
  avec repli sur le PDF livré dans l'app.
- ⚠️ **La table des matières est codée en dur dans `ManualViewer.tsx`** (id, titre, **numéro de
  page**). Toute repagination impose une modification du code et un déploiement. À prendre en
  compte : mieux vaut figer la liste des sections une fois pour toutes.
- ⚠️ **Chapitre 6.2 entièrement mort** : il décrit les modes *mixte*, *manuel* et *PDF
  historique*. Aucun n'existe plus.
- ⚠️ **Chapitre 9 « Évolutions prévues »** : annonce la réduction de la dépendance aux PDF. C'est
  fait. Devenu de l'histoire.

---

## 1. Installation et préparation

| | Élément |
|---|---|
| ✅ | Éviter la mise en veille de l'écran |
| ✅ | Créer un dossier dédié dans Fichiers |
| ✅ | Ouvrir avec Safari, ajouter à l'écran d'accueil |
| 🆕 | **Comportement hors couverture réseau** : precache du service worker, repli LTV sur le dernier normalisé connu |
| 🆕 | **Mise à jour de l'application** — bouton « Forcer la mise à jour » |

## 2. Démarrage d'un parcours

| | Élément |
|---|---|
| ⚠️ | Bouton **Démarrer** → modale **« Sélection du mode de démarrage »** (le manuel décrit 3 modes disparus) |
| 🆕 | **Mode 2026** — train choisi dans la liste normalisée, PDF LTV optionnel, SECOURS **disponible** |
| 🆕 | **Mode LTV seul** — consultation, ni train ni fiche, LTV du parcours PK ≥ 616 |
| ✅ | « Modifier le mode de démarrage » depuis les paramètres |
| 🆕 | Démarrage **sans PDF** : le parcours part avec les dernières LTV connues, datées |
| 🆕 | **Réinitialiser le parcours** |
| 🆕 | **STOP** — arrêt de session, retour à l'écran initial, **envoi du journal** |

## 3. Barre de titre — contrôles permanents

| | Élément |
|---|---|
| ✅ | Horloge |
| ✅ | Mode jour / nuit |
| ✅ | Réglage de luminosité (`Lum:`) |
| ✅ | Roue dentée → Paramètres |
| 🆕 | **Appui LONG sur la roue** → menu avancé (dev) |
| ✅ | Indicateur **GPS** (couleurs) |
| 🆕 | Indicateur **🕑 mode horaire** et son clignotement orange (standby) |
| 🆕 | Badge **NORMAL / SECOURS / DEMO / MAJ** |
| 🆕 | Badge **ARRÊT** — et le **clic dessus = sortie manuelle du standby** |
| 🆕 | **Delta horaire** (avance / retard) |
| ❓ | Numéro de train affiché, bascule ES/FR automatique, et sa correction manuelle |

## 4. Menu Paramètres (appui court)

| | Élément |
|---|---|
| ✅ | Modifier le mode de démarrage |
| 🆕 | **Défilement fiche train : Vertical / Horizontal** |
| 🆕 | **Échelle horizontale** (px/km) de la fiche horizontale |
| 🆕 | **Mise à l'échelle de la fiche train** — case + curseur d'espacement, seuil d'exactitude, bouton « Revenir au seuil » |
| 🆕 | **Manuel utilisateur** |
| 🆕 | **Guia BSN** — sous-titré « Livret d'aide à la conduite » (`guia-bsn.pdf`) |
| 🆕 | **À propos — version & changelog** |
| 🆕 | **Forcer la mise à jour** |

## 5. Menu avancé (appui long) — ❌ HORS MANUEL (tranché le 19/08)

| | Élément |
|---|---|
| ✅ | **Mode test** (chapitre 8 du manuel actuel) |
| 🆕 | **Autoriser le mode portrait** |
| 🆕 | Afficher les appuis (présentation) |
| 🆕 | OCR online |
| 🆕 | Mode démo |
| 🆕 | Exporter log + PDF |
| 🆕 | Replay |

❌ **Tranché le 19/08 : ce menu ne figure pas dans le manuel.** Il est réservé aux essais de
l'utilisateur. Conséquences à assumer :
- le **chapitre 8 « Mode test »** du manuel actuel **disparaît** (4 pages sur 26) ;
- **Mode démo** et **Replay** sortent aussi des annexes du chapitre 9 ;
- ⚠️ **« Autoriser le mode portrait » sort du manuel avec le reste** — voir la question ci-dessous.

## 6. Zones d'affichage

### 6.1 Bloc Infos
| | Élément |
|---|---|
| ⚠️ | Numéro, catégorie, origine/destination, date — **le format 2026 a changé le contenu** |
| 🆕 | Composition, longueur, masse, logo opérateur |
| 🆕 | **Moteurs isolés** — pictogramme, et l'incidence sur la conduite |
| 🆕 | **Pli / dépli** du bloc Infos + LTV, et ce que ça change à l'écran |
| 🆕 | Bloc **« prochain arrêt »** en mode plié |

### 6.2 Zone LTV
| | Élément |
|---|---|
| ✅ | Tableau des LTV |
| 🆕 | En-tête « N LTV — Actualisées le … » |
| 🆕 | **Import du PDF LTV**, et le repli sur les dernières LTV connues |
| 🆕 | **Surlignage d'une LTV** au clic sur sa vitesse dans la fiche |
| 🆕 | **Mode portrait** : colonnes resserrées, en-têtes de groupe pivotés |

### 6.3 Fiche train verticale
| | Élément |
|---|---|
| ⚠️ | Description générale (le manuel actuel ne liste même pas les colonnes) |
| 🆕 | **Les 10 colonnes 2026** : Bloc, Vmax, KM, Établissements, Arr, Pass, Dép, Radio, ↗, ETCS |
| 🆕 | **Trois heures distinctes** (arrivée / passage / départ) et la pastille jaune des arrêts |
| 🆕 | **Défilement automatique** et son activation |
| 🆕 | **Scroll intelligent** — la valeur d'une colonne reste affichée quand sa ligne est sortie de l'écran |
| 🆕 | **Mise à l'échelle** — espacement proportionnel à la distance, graduations kilométriques |
| 🆕 | **Indicateur de position** — couleur selon l'état, barre et flèche en mode test |
| 🆕 | **Bandes LTV et bandes de notes** en surimpression |
| 🆕 | **Sélection d'une ligne** (standby manuel), cadre rouge clignotant |

### 6.4 Fiche train horizontale ❓
| | Élément |
|---|---|
| 🆕 | **Vue horizontale entière** — absente du manuel |
| 🆕 | Graphe vitesse/distance, barre de position, échelle réglable |
| 🆕 | **Profil en long** de la ligne (silhouette du relief) |
| 🆕 | Bandes de tunnel |

✅ **Tranché le 19/08** : la vue horizontale n'est plus expérimentale. La mention « exp. » a été
retirée du sélecteur. Elle se documente donc comme une **fonction à part entière**, au même rang
que la fiche verticale — et non comme une curiosité en fin de manuel.

## 7. Conduite — états et automatismes

| | Élément |
|---|---|
| ✅ | Indicateur GPS |
| ✅ | Indicateur du mode horaire |
| ✅ | Activation et effets du mode conduite |
| ⚠️ | Fonctionnement en mode GPS / en mode horaire — **le principe a changé** |
| 🆕 | **Cheminement à l'estime** : en horaire, la position progresse depuis la dernière position connue en suivant la **courbe empirique**, elle ne se téléporte plus à l'heure théorique |
| 🆕 | **Le delta n'influence plus la localisation** — il redevient purement commercial |
| 🆕 | **Standby** — automatique et manuel, ce qui le déclenche, comment en sortir |
| 🆕 | **Détection d'arrêt** et confirmation du départ |
| 🔜 | **Bouton de sortie de standby** — décidé le 19/08, **PAS ENCORE CODÉ**. Voir l'encadré ci-dessous : ne pas rédiger ce passage avant que ce soit en place. |
| 🆕 | Zones tunnel : pourquoi le GPS y est ignoré |
| ✅ | Recalage en mode horaire |

> ### 🔜 Chantier décidé le 19/08 — bouton de sortie de standby (non codé)
>
> **Constat** : en fiche verticale, la ligne clignotante fait comprendre qu'on attend une action.
> En fiche **horizontale**, rien ne le dit. Et le 🕑 orange de la barre de titre est un
> `<button>` sans `onClick` : c'est un voyant, pas une commande.
>
> **Corrigé de ma part** : je croyais le standby initial différent du standby d'arrêt détecté.
> C'est faux — dans les deux cas on confirme une heure de départ, et le delta se recale
> (`recalibrateAtTimeRef` ancré sur l'heure du premier mouvement). La vraie distinction est
> **en gare / hors gare** : un arrêt en pleine ligne journalise `gps:arret:departure-no-recal`
> et ne recale rien, faute d'heure théorique à laquelle se comparer.
>
> **Décidé** :
> - un bouton en surimpression, dans les **deux** modes d'affichage ;
> - libellé du type « Reprendre » ou « Confirmer le départ » ;
> - visible **seulement en mode horaire** — en GPS le départ se détecte seul au bout de 75 m ;
> - visible **seulement à partir de l'heure de départ prévue moins une minute** ;
> - il **s'AJOUTE** aux sorties existantes, il ne les remplace pas.
>
> **Ce que le caractère additif préserve** : le clic sur le badge ARRÊT en mode GPS, qui n'est
> pas une confirmation mais un **forçage** de reprise quand le départ n'a pas été détecté — seul
> filet de secours dans ce cas ; et la sortie possible quand l'heure de départ est inconnue ou
> qu'il faut partir plus tôt, cas où la condition d'apparition du bouton n'est jamais remplie.

## 8. Cas particuliers et secours

| | Élément |
|---|---|
| ✅ | Arrêts en gare |
| ⚠️ | **Mode secours** — à revoir entièrement |
| 🆕 | **Secours LTV** : affichage du PDF LTV source, bascule FT ↔ LTV par boutons et par glissement |
| 🆕 | **Livret FT de secours** — `documents/livret-ft.pdf` + index de pages, préchargé au démarrage, repli quand la fiche train n'est pas disponible. ⚠️ **À ne pas confondre** avec le « Livret d'aide à la conduite » du menu Paramètres, qui est le Guia BSN. |
| 🆕 | Perte de couverture réseau en cours de parcours |

## 9. Annexes candidates

| | Élément |
|---|---|
| 🆕 | **Mode portrait** — à documenter dans le corps du manuel : c'est un réglage normal, actif par défaut, avec la case des Paramètres pour figer la présentation paysage |
| ❌ | ~~Mode test, diagnostic, export des journaux~~ — hors manuel |
| ❌ | ~~Mode démo~~ — hors manuel |
| ❌ | ~~Replay~~ — hors manuel |
| 🆕 | Glossaire : PK, s_km, BAL/BCA/ETCS1, LTV, LFP/ADIF/RFN, SDM |

---

## 10. Réglages mémorisés sur l'appareil

Relevés dans le code. **Aucun n'est mentionné dans le manuel actuel.**

| Clé | Réglage |
|---|---|
| `theme` | jour / nuit |
| `brightness` | luminosité |
| `lim:ft-scroll-mode` | fiche verticale ou horizontale |
| `lim:fth-scale` | échelle horizontale (px/km) |
| `lim:ft-scale-offset` | écart au seuil d'exactitude de la mise à l'échelle |
| `lim:allow-portrait` | autorisation du mode portrait |
| `lim:touch-indicator` | affichage des appuis |
| `ocrOnlineEnabled` | OCR en ligne |
| *(+ le mode de démarrage, stocké séparément)* | |

---

## 11. Ce que je te demande de vérifier dans cette liste

1. ~~**Le menu avancé** : dans le manuel, en annexe, ou pas du tout ?~~
   → **répondu le 19/08 : pas du tout.** Mais voir la question 5, qu'il fait naître.
2. ~~**La fiche horizontale** : « expérimentale » ou fonction à part entière ?~~
   → **répondu le 19/08 : fonction à part entière.**
3. ~~Manque-t-il une **fonction que tu utilises** et que je n'ai pas vue ?~~ → **répondu : non.**
   *(question d'origine)* Manque-t-il une fonction que tu utilises et que je n'ai pas vue ? C'est le seul angle mort
   que le code ne me donne pas : il me dit ce qui existe, pas ce qui sert.
4. ~~Le manuel s'adresse-t-il **au seul conducteur**, ou aussi à toi en tant que mainteneur ?~~
   → **répondu le 19/08 : au conducteur, et du point de vue de l'USAGE.** Voir la règle
   rédactionnelle ci-dessous, qui vaut pour tout le document.
5. ~~**« Autoriser le mode portrait » doit-il rester dans le menu avancé ?**~~
   → **répondu le 19/08 : non.** La case est passée dans les Paramètres, **cochée par défaut**.
   Décocher ne bloque plus rien : ça fige la présentation paysage.

---

## 11 bis. RÈGLE RÉDACTIONNELLE (posée le 19/08) — à appliquer partout

**On décrit l'expérience, pas le moteur.** Le manuel dit ce que le conducteur voit et ce qu'il
doit en conclure ; il n'explique pas comment c'est calculé.

Exemples donnés par l'utilisateur :
- **« Mode horaire »** → on garde ce nom, **même s'il n'est plus fondé sur l'horaire**, par
  cohérence avec l'application **Sirius** que les conducteurs connaissent. On le définit
  simplement comme **le mode utilisé quand il n'y a pas de GPS**. On n'explique PAS comment la
  position y est estimée — ni courbe empirique, ni cheminement à l'estime, ni ancrage.
- **Composition et moteurs isolés** → on dit que **les modifier influe sur la localisation en
  mode horaire**. On s'arrête là.

⚠️ **Conséquence sur cet inventaire** : plusieurs lignes du chapitre 7 sont rédigées en termes de
mécanisme (« cheminement à l'estime », « le delta n'influence plus la localisation »). Ce sont des
repères POUR MOI, pas des titres de sections. À traduire en formulation d'usage au moment du plan.

---

## 12. Chantier séparé — manuel de l'ÉDITEUR

Évoqué le 19/08. `lim-editor` a son propre public (toi, et qui publiera les données), son propre
vocabulaire et ses propres gestes : publication du normalisé, des LTV, des documents gérés
(manuel, livret FT). **À traiter dans une conversation dédiée**, pas ici — mais noté pour ne pas
l'oublier au moment de figer la table des matières de celui-ci.
