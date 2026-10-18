# Lecture de la voie parcourue et recalage du ruban — dossier de référence

Établi le 11/10/2026 (soir), à partir des journaux du 9710 (Perpignan → Barcelone, 11h58) et du 9705
(Barcelone → Perpignan, 15h12) et des explications de l'utilisateur. **Rien n'est codé.** Ce dossier sert
de point de départ le jour où l'on décide de faire ce chantier, jugé complexe et chronophage.

## 1. Pourquoi on veut connaître la voie

- Les LTV (limitations temporaires) sont données **par voie** (ex. 11/10 : 160 km/h de 654,046 à 640,459 voie II,
  à 636,000 voie I). Pour la courbe empirique de localisation en tunnel, il faut savoir si la LTV s'applique au train.
- Règle déjà retenue (todo) : une LTV de l'une OU l'autre voie dans la fenêtre d'un tunnel → tunnel « incertain » →
  on tranche par le test vitesse GPS réelle vs vitesse prévue à l'entrée. **Connaître la voie rend ce test inutile
  dans la majorité des cas.**
- Contexte espagnol : voies **banalisées**, pas de « voie habituelle par sens » ; saisie manuelle en cabine refusée
  (complexité). La voie doit donc être **lue** par l'app, ou déduite par des règles.

## 2. Ce que les journaux montrent déjà (deux parcours, 11/10)

Méthode de lecture : pour chaque fix GPS avec précision ≤ 8 m, écart latéral **signé** entre le fix et le ruban
dense (`src/lib/ligne050_ribbon_dense.ts`, 7511 points tous les 25 m), signe = produit vectoriel avec la direction
du ruban (positif = à gauche du sens Sud → Nord), médiane par km. Script :
`S:\Dev\LIM2\scripts\voie_lateral.py` (usage : `python -I -X utf8 scripts/voie_lateral.py <journal.log>` ; ne dépend que du ruban et d'un journal).

Résultats :
- **Le ruban suit à peu près la voie 1** en Espagne (écart ≈ 0) ; la **voie 2 apparaît à +4 à +5 m**.
- 9710 (NS) : récit de l'utilisateur reproduit : Figueres voie 3 en gare (−8 m), voie 2 jusqu'à Gérone, voie 1
  après Gérone, bascule vers voie 2 à Vilobí (pk 703,5), bascule vers voie 1 à Bif. Mollet (pk ≈ 640) jusqu'à
  Barcelone.
- 9705 (SN) : « voie 1 pratiquement partout », sauf traversée de **Figueres côté voie 2** et un court passage
  voie 2 entre la sortie du tunnel du Perthus et le saut de mouton. Comparé km par km au 9710 : décalage attendu
  (≈ −4 m) bien visible sur Mollet → Vilobí et Gérone → Figueres ; **mais** pas de décalage pk 676-680
  (Sant Celoni / Riells) et lecture « plus à gauche » entre la limite ADIF-LFP (752,4) et le pk LFP 27,8,
  contraire au récit.
- Conclusion : **le ruban a un biais latéral local de ±3 m à l'échelle du km** (tracé à la main sur l'imagerie ;
  l'utilisateur a vu des points faux dès la sortie de La Sagrera, « sûrement pareil dans toutes les courbes »).
  Une lecture fix par fix ou km par km n'est **pas** fiable ; une lecture par **section** l'est.
- Partie française (LFP au nord du Perthus, RFN) : ruban imprécis (±10 à 60 m), inexploitable pour la voie.


### 2b. Troisième parcours : 9712 du 18/10 (NS, lim-logs `9712 du 2026-10-18 - 13h01.zip`)

Voie déclarée par l'utilisateur : voie 2 de Perpignan au raccordement SNCF/LFP, voie 1 jusqu'au saut de mouton, voie 2 du
saut de mouton à l'aiguille du km 644 (Bif. Mollet), voie 1 jusqu'à Barcelone (obligatoire, voie 2 en travaux).

Écart latéral médian par section entre zones d'aiguillages (`scripts/voie_sections.py`, fixes ≤ 8 m), les trois journaux :

| Section (PK) | 9712 18/10 | 9710 11/10 | 9705 11/10 |
|---|---|---|---|
| Pontos → Girona (738,1-714,7) | +7,4 (voie 2) | +6,3 (voie 2) | +1,4 (voie 1) |
| Girona → Vilobí (714,7-703,5) | +5,6 (voie 2) | +0,6 (voie 1) | +3,0 (voie 1 ?) |
| Vilobí → Riells (703,5-678,1) | +5,0 (voie 2) | +3,8 (voie 2) | +1,3 (voie 1) |
| Riells → Llinars (678,1-662,5) | +5,7 (voie 2) | +5,3 (voie 2) | +0,5 (voie 1) |
| Llinars → Mollet 644,3 | +4,3 (voie 2) | +3,6 (voie 2) | +1,3 (voie 1) |
| Mollet 644,3 → Sagrera | −0,1 (voie 1) | +0,1 (voie 1) | +0,5 (voie 1) |
| Gare de Figueres (749,3-749,8) | +27,8 (voie 2) | −8,3 (voie 3) | +24,1 (voie 2) |
| Figueres sud → Pontos (749,3-738,1) | +4,7 (voie 2) | +3,3 (voie 2) | +1,5 (voie 1) |
| Jonquera sud → limite ADIF (LFP 29,7-44,4) | +3,0 (voie 2) | −1,6 (?) | +2,8 (« voie 1 ») |
| Sortie Perthus → Jonquera nord (LFP 25,6-28,9) | +5,0 (voie 2) | −3,8 (?) | +4,0 (« voie 1 ») |
| Limite LGV → saut de mouton (LFP 0-12,9) | −4,5 (voie 1) | −0,0 (?) | −2,8 (voie 1) |

Conclusions :
- **Côté ADIF, la lecture par section est fiable** : voie 1 = 0 à +1,5 m, voie 2 = +4 à +7 m, sur les trois parcours,
  sans exception. Mollet → Barcelone lit voie 1 les trois fois. La gare de Figueres a une signature nette : voie 2 à quai
  ≈ +25 m, voie 3 ≈ −8 m (le ruban y suit une autre voie).
- **Côté LFP (Jonquera → Perthus)**, le 9712 (voie 2 déclarée) lit la MÊME chose que le 9705 du 11/10 (voie 1 déclarée),
  et le 9710 du 11/10 lit 4 à 9 m plus à droite. Hypothèse à vérifier auprès de l'utilisateur : le 9705 du 11/10, passé
  côté voie 2 à Figueres, serait resté voie 2 jusqu'aux aiguilles de La Jonquera ou de Tresserres (il n'y a pas
  d'aiguillage entre Figueres nord et la limite ADIF). Question en attente.
- **Côté RFN et saut de mouton → Tresserres** : peu de fixes, ruban imprécis, lecture non concluante.

### 2c. Premier journal avec la tuile VOIE : 9707 du 18/10 (SN, lim-logs `9707 du 2026-10-18 - 16h06.zip`)

- Trois clics enregistrés (`ui:voie:set`), chaque fix porte `voie`. L'utilisateur signale qu'il n'a PAS cliqué pour la
  traversée de Figueres (passée côté voie 2) : lecture à quai à confronter au journal.
- **Règle apprise (utilisateur)** : le passage voie 1 → voie 2 à la sortie de Figueres côté France ne sera **jamais**
  détectable par le GPS, l'aiguille est dans le tunnel (T31, 750,47 → 752,22). À poser par règle ou par lecture après
  la sortie du tunnel, comme à Gérone.
- La courbe empirique de Figueres dépend de la voie (entrée à 30 km/h voies 4/6, 80 km/h voie 3 : +110 s sur le
  segment NS avec la médiane de 3 runs) : c'est l'un des intérêts de connaître la voie. Objectif fixé par
  l'utilisateur : détection **semi-automatique** (le plus automatique possible, mais toujours corrigible à la main
  via la tuile VOIE, même quand la détection existera).

## 3. Les règles qui simplifient tout (utilisateur, 11/10)

1. **On ne change de voie qu'aux aiguillages.** Entre deux zones d'aiguillages, la voie lue en sortie de zone est
   acquise jusqu'à la zone suivante, **même si les points du ruban y sont faux**. Il n'y a donc PAS à vérifier
   7511 points : seulement le ruban autour des zones de changement.
2. **Chaque aiguillage a une vitesse de franchissement.** Une baisse temporaire à cette vitesse (ex. 160 à Llinars)
   + un décalage latéral GPS = quasi-certitude de changement de voie. (Signature combinée.)
3. **Au saut de mouton, on change TOUJOURS de voie** (par construction).
4. **Mollet → Barcelone = voie 1 obligatoire** : voie 2 en travaux, inutilisable « pour plusieurs années »
   (voir mémoire `reference_voie_unique_pk644`). Cette section fournit des fixes « voie 1 » certains pour calibrer.
5. En Espagne les deux voies sont **parallèles et équidistantes** (≈ 4,5 m) ; pas en France (elles s'écartent par
   endroits). L'idée d'un « 2e ruban parallèle » a été écartée : il hériterait du même biais et l'écart signé
   porte déjà l'information.

## 4. Où l'on peut changer de voie (guide `public/guia-bsn.pdf`, pages 1 et 36)

Légende donnée par l'utilisateur : **PCA = poste de cantonnement** (un signal, pas de changement de voie) ;
**PBA = poste de banalisation** (changement possible) ; **PAET = poste de stationnement** (changement possible +
voies de garage ; « 100/160/220 » = 100 accès garage, 160 changement de voie, 220 tout droit, en pratique 200).

| Zone | PK (ADIF sauf mention) | Vitesse d'aiguille | Remarques |
|---|---|---|---|
| Barcelona Sants | 621 | — | gare, souterrain, pas de GPS |
| La Sagrera AV | 627,7 | — | gare, sortie du souterrain |
| Banalización km 639,3 | 639,3 | 100 | zone Mollet |
| Ag. Bif. MOL / Bif. Mollet | 640,5 · 641,3 · 644,3 | 60/100 | côté Barcelone : voie 1 obligatoire (travaux) |
| PCA La Roca | 654,1 | — | **pas de changement** |
| **PBA Llinars** | 662,5 | **160** | changement possible |
| PCA St Celoni | 670,5 | — | pas de changement |
| **PAET Riells** | 678,1 | 100/160/220 | changement possible |
| PCA Riudarenes | 691,8 | — | pas de changement |
| **PAET Villobí** | 703,5 | 100/160/220 | changement possible |
| Bif. GIR Merc. / E2B | 710,7 · 711,3 | — | bifurcation fret, à préciser |
| **Gérone** | 714,7 | 45 | gare en **tunnel** : changement constaté seulement à la sortie du tunnel |
| PCA Vilademuls | 726,1 | — | pas de changement |
| PCA Pontos | 738,1 | — | pas de changement |
| **Figueres** | 749,6 | voies 4 et 6 : 30 ; voie 3 : 80 | 3 voies à quai + **arrêt** → cas le plus complexe |
| *Figueres, configuration (utilisateur 18/10)* | | | Voies 1 et 2 = voies directes, **pas à quai**, jamais empruntées par les voyageurs. Côté voie 1 : voie 3 à quai (la voie 5, plus loin, n'est pas à l'écartement standard). Côté voie 2 : voies 4 et 6 à quai. Ordre de gauche à droite dans le sens Perpignan → Barcelone : **3, 1, 2, 4, 6**. Lectures à quai : voie 3 ≈ −8 m (9710 11/10), côté voie 2 (4 ou 6) ≈ +24 à +28 m (9705 11/10, 9712 18/10). |
| Limite ADIF / LFP | 752,3 | — | |
| Aiguilles Jonquera sud / nord | LFP 29,735 / 28,911 (s 151,22 / 151,88) | ? | `src/lib/ancres_lfp.ts` |
| Tunnel du Perthus | LFP 25,589 → 17,201 | — | pas de GPS |
| Aiguilles Tresserres sud / nord | LFP 16,297 / 14,608 (s 164,59 / 166,21) | ? | « court passage voie 2 » du 9705 |
| **Saut de mouton** | LFP 12,920 (s 167,94) | — | changement **systématique** |
| Perpignan | RFN 467,5 | — | ruban s'arrête au point de gare, train 178 m au-delà |

Autre source disponible : `C:\Users\micha\Dropbox\LIM\Esquema de vías y aparatos de vía (Barcelona-Figueras.)
2022-09-12 20_42_17 2.pdf` (schéma ADIF des appareils de voie).

## 5. Matière déjà disponible

Fixes propres (précision ≤ 8 m) sur les 3 km qui suivent chaque zone dans le sens de marche, journaux du 11/10 :

| Zone | 9705 SN | 9710 NS |
|---|---|---|
| Mollet 639,3-644,3 | 58 | 54 |
| Llinars 662,5 | 56 | 54 |
| Riells 678,1 | 55 | 56 |
| Villobí 703,5 | 55 | 56 |
| Gérone 714,7 (3 km après) | 4 | 9 → prendre la fenêtre APRÈS la sortie du tunnel |
| Figueres 749,6 | 306 | 132 |

Cadence GPS ≈ 1 fix/s côté espagnol → ~55 fixes par zone et par sens : largement assez pour un décalage de 4,5 m.

Journaux (dépôt privé `michaelecalle/lim-logs`) : `9710 du 2026-10-11 - 11h58.zip`, `9705 du 2026-10-11 - 15h12.log`,
`9712 du 2026-10-18 - 13h01.zip` (voie connue sur tout le parcours, voir §2b).
Voie connue : 9710 = récit du §2 ; 9705 = voie 1 sauf Figueres (voie 2) et Tresserres → saut de mouton (voie 2).
Depuis le build du 11/10 17:24, chaque journal porte `# build=` dans son en-tête.
**Depuis le build du 18/10 16:01 (commit 3263acf)** : tuile **VOIE** dans le bloc info (après MOT. ISOLÉS), voie 1 par
défaut, un clic bascule 1 ↔ 2, remise à 1 à chaque nouveau train. Chaque clic écrit `ui:voie:set {prev, voie}` et chaque
fix `gps:position` porte `voie` : la voie déclarée est connue à chaque fix, plus besoin du récit après coup. À Figueres,
« voie 2 » = côté voie 2 (voie 4 ou 6 à quai). Pas de code couleur pour l'instant (étape 2, quand la signature par zone
sera validée) : l'idée de l'utilisateur = vert si la voie déclarée = celle estimée, rouge sinon, orange si pas de données.

## 6. Plan proposé (à valider étape par étape, rien n'est acquis)

1. **Lire la voie par zone** sur les deux journaux du 11/10 : pour chaque zone du §4, écart latéral médian sur les
   2-3 km qui suivent, dans le sens de marche, + vitesse GPS minimale dans la zone (signature « 160 »). Montrer le
   tableau à l'utilisateur, le confronter à son récit.
2. **Recaler le ruban** uniquement là où c'est utile : 2-3 km après chaque zone, par sens, en moyennant les fixes
   « voie 1 » certains (9705 du 11/10 + section Mollet → Barcelone de tous les parcours depuis les travaux).
   Garder le ruban actuel partout ailleurs (tunnels compris). Chaîne : pas de convertisseur KMZ → app ; le ruban
   actuel vient de `C:\Users\micha\Dropbox\LIM\ligne050_points_25m_sud_nord_v2.kmz` (identique à 0 m près) ;
   `scripts/densify_ribbon.js` densifie un fichier ruban TS ; `EXPORT_KML_RUBAN_ANCRES.bat` exporte ruban + ancres
   vers `exports/diagnostic_ruban_ancres.kml` pour Google Earth. Fichier d'aide écrit le 11/10 :
   `C:\Users\micha\Dropbox\LIM\zones_ruban_a_verifier_11oct.kml` (3 segments colorés).
3. **Dans l'app** (plus tard) : état « voie courante » = inconnu au départ, posé à chaque zone d'aiguillages par la
   signature combinée, forcé à voie 1 entre Mollet et Barcelone, inversé au saut de mouton ; sert à filtrer les LTV
   par voie pour la courbe empirique. Girona : décision à la sortie du tunnel ; Figueres : à concevoir à part.
4. Chaque nouveau parcours où l'utilisateur indique la voie affine la calibration. Les vérifications visuelles dans
   Google Earth se limitent aux rares zones où le calcul donne un résultat incohérent, un segment à la fois.

## 7. Points ouverts

- Vitesses d'aiguilles des zones LFP (Jonquera, Tresserres) : à demander.
- Bif. GIR Merc. 710,7 : s'agit-il d'un changement de voie possible pour nos trains ?
- Figueres : comment lire la voie avec un arrêt à quai (voie 2 à la traversée, voie 3 avec arrêt, 4/6 à 30 km/h).
- Le ruban recalé ne change presque rien à la position affichée (l'abscisse le long de la ligne est insensible à un
  décalage latéral de quelques mètres) : son seul intérêt est la lecture de la voie.
