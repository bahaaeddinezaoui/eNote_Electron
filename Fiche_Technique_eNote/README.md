# Fiche technique eNote

Version LaTeX de la fiche technique de l'application **eNote**, remplie à partir du modèle
`Template_Fiche_Technique.zip`. La structure des fichiers, l'ordre des chapitres et le préambule sont
ceux du modèle.

## Compilation

```bash
cd Fiche_Technique_eNote
pdflatex main.tex
pdflatex main.tex   # deuxième passe : table des matières, renvois et liste des figures
```

Ou avec `latexmk` :

```bash
latexmk -pdf main.tex
```

Le rendu compilé est `main.pdf` (77 pages). Si un lecteur PDF garde le fichier ouvert, écrire dans un
dossier de sortie puis copier :

```bash
mkdir -p _out && tectonic --outdir _out main.tex && cp _out/main.pdf ./main.pdf
```

Deux ajustements au modèle étaient nécessaires pour compiler : `\PassOptionsToPackage{table}{xcolor}`
avant `tikz` (sinon conflit d'options avec `xcolor`) et `\sloppy` après `\begin{document}` pour que
les longs identifiants ne dépassent pas la marge. La bibliothèque TikZ `arrows.meta` et
`shapes.geometric` est chargée pour les flèches et les ellipses des figures.

## Figures

Le modèle physique de données et le diagramme de cas d'utilisation sont dessinés en TikZ, à partir du
schéma PostgreSQL réel (111 tables, 157 clés étrangères, 76 séquences). Ils sont inclus par
`chapitres/chapitre1.tex` :

| Fichier | Contenu |
| --- | --- |
| `figures/mpd_domaines.tex` | carte des six domaines et des 111 tables |
| `figures/mpd_identite.tex` | MPD des entités d'identité et de comptes |
| `figures/mpd_scolarite.tex` | MPD des entités de scolarité et d'évaluation |
| `figures/usecase.tex` | 28 cas d'utilisation et 7 acteurs métier |

Les captures d'écran du chapitre 3 restent à fournir : elles sont appelées via `\IfFileExists`, donc
un cadre de remplacement s'affiche tant que le fichier manque. Déposer les images dans `images/` avec
les noms attendus :

| Fichier | Contenu |
| --- | --- |
| `images/logo_gauche.png`, `images/logo_droite.png` | logos de la page de garde |
| `images/commun_*.png` | fonctionnalités communes |
| `images/admin_*.png` | parcours de l'administrateur |
| `images/directeur_*.png` | parcours du directeur |
| `images/secretariat_*.png` | parcours du secrétaire |
| `images/enseignant_*.png` | parcours de l'enseignant |
| `images/etudiant_*.png` | parcours de l'étudiant |
| `images/planificateur_*.png` | parcours du planificateur |
| `images/developpeur_*.png` | parcours du développeur |

La liste exacte figure sous chaque `\fbox` du document.

### Captures d'écran

`images/MANIFESTE.txt` donne les 66 noms attendus et la légende de chaque figure. Les captures doivent
être prises dans l'application, interface en français, sur des données fictives (aucun nom d'élève
réel), en PNG d'au moins 1440 pixels de large. Une fois les fichiers déposés dans `images/`, aucune
modification LaTeX n'est nécessaire : la compilation les insère à la place des cadres de
remplacement, dans l'ordre du document.

## À compléter

- page de garde et en-tête : sigle, nom complet, ministère, direction, service, année ;
- caractéristiques du poste de développement (chapitre 2) ;
- captures d'écran listées ci-dessus.

Les faits techniques du document sont tirés du dépôt : version 4.0.0, 111 tables, 157 clés étrangères,
76 séquences, 34 déclencheurs, 51 fonctions, sept rôles, trois langues, quatre apparences et quatre
palettes.
