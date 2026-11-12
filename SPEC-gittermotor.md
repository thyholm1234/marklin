# Spec: gittermotor til banebygning

Opgave til en udvikleragent. Læs hele dokumentet før du skriver kode.

## 1. Baggrund

Projektet er en webapp (ren JavaScript, ingen byggetrin, ingen afhængigheder), der genererer
Märklin C-skinne-baner ud fra et lager af skinner og en pladestørrelse. Koden ligger i
`static/js/`:

| Fil | Indhold |
|---|---|
| `core.js` | Katalog, geometri (`walkGeo`, `layoutChain`), lager (`spareNow`, `takeArc`), kollision |
| `graph.js` | Sporgraf: `validate` (alle skinneender mødes), `analyze` (vending, ruter, fælder) |
| `topologies.js` | Grundformer: oval/sløjfe, hundeben, punkt-til-punkt, ottetal |
| `elements.js` | Stationer, blindspor, sporforbindelser m.m. lagt på en færdig grundform |
| `router.js` | Ruteløser: porte (`enumPorts`), forbindelse (`solve`, `buildLink`), frihøjde (`clearPath`), `addLinks`, `addCornerCross`, `addExtraLoop` |
| `generator.js` | `MK.generate`: vælger grundform, vokser den, lægger elementer på, giver point |
| `worker.js`, `app.js` | Web Worker og brugerflade |

Datamodel: en bane er `{ chains, sides }`. En kæde har `pieces` (hver med `art`, `geo`, evt.
`branch`, `virtual`, `run`), `start`, `cyclic`, `eligible`, `kind`. Læs kommentarerne øverst i
`core.js` og `router.js`.

### Problemet

Banerne bliver for simple, og årsagen er motoren, ikke vægtene:

1. Grundformerne er skabeloner, der alle er punktsymmetriske, fordi symmetri er det eneste, der
   i dag garanterer at en sløjfe lukker. L-, U- og foldede former kan ikke opstå.
2. Ruteløseren regner i decimaltal og kræver, at to lige længder tilfældigt rammer lageret inden
   for 0,7 mm. Målt: ca. 15 % af portparrene har en løsning, når begge porte ligger på samme
   bane; næsten ingen, når en sløjfe er lagt frit ind (`addExtraLoop` lykkedes 1 af 30 gange).
3. Ruten har én fast form (bue · lige · bue · lige · bue).

### Idéen

C-sporets geometri er et gitter: alle retninger er multipla af 30°, og alle mål er hele tiendedele
millimeter. Regner man positioner eksakt som heltal, bliver "lukker banen" og "mødes de to ender"
til sammenligning af heltal, og man kan søge frit efter ruter og sløjfer i stedet for at bruge
skabeloner.

## 2. Mål og afgrænsning

**Skal leveres**

- A. `lattice.js`: eksakt gitterregning (afsnit 3).
- B. Ny forbindelsessøgning i `router.js`, der mødes på midten (afsnit 4), bag den eksisterende
  grænseflade.
- C. Ny grundform "Fri sløjfe" i `topologies.js`, bygget med samme søgning (afsnit 5).
- D. Målinger før og efter (afsnit 7).

**Skal ikke ændres**

- `graph.js` er dommeren. Enhver bane, der returneres, skal have `MK.graph.validate(layout)`
  tom og intet varenummer brugt ud over lageret. Det tjekkes allerede i `generate`; fjern det ikke.
- Pointvægtene i `W8` (`generator.js`). De er aftalt med brugeren.
- Brugerfladen, ud over at den nye grundform og de nye filer skal med (afsnit 6).
- Eksisterende grundformer og elementer skal blive ved med at virke.

**Uden for opgaven**

- 15°- og 7,5°-kurver i den nye søgning (de falder uden for 30°-gitteret). De må gerne bruges af
  den gamle kode som hidtil.
- Trinvis forbedring af en færdig bane (lokal søgning). Kun hvis A–D er færdige og målt.

## 3. Del A: `lattice.js`

Eksporteres som `MK.lattice`. Samme modulmønster som de andre filer (IIFE, `root.MK`).

### Tal

Lad ζ = e^(iπ/6) (30°). En position er et element i Z[ζ] skrevet som fire heltal
`[a, b, c, d]` = a + bζ + cζ² + dζ³, i enheden 0,1 mm.

- Regneregler: ζ⁴ = ζ² − 1, ζ⁶ = −1.
- Gange med ζ (drej 30° mod uret): `[a, b, c, d] → [−d, a, b + d, c]`.
- Til millimeter: `x = (a + b·√3/2 + c/2) / 10`, `y = (b/2 + c·√3/2 + d) / 10`.
- En retning er et heltal `k` i 0..11 (k · 30°).

### Skridt

Et skridt er en eller flere rigtige skinner, der starter og slutter i en gitterretning. Det har
en lokal forskydning (start i origo, retning 0), en drejning i 30°-enheder og en liste af
varenumre med geometri (til at bygge kædestykkerne bagefter).

| Skridt | Lokal forskydning | Drejning |
|---|---|---|
| Lige stykke, længde L | `[L, 0, 0, 0]` | 0 |
| Bue 30° venstre, radius R | `R · [1, 0, −1, 1]` | +1 |
| Bue 30° højre, radius R | `R · [0, 0, 1, −1]` | −1 |
| Makro (se nedenfor) | `[X, 0, 0, Y]` afrundet til 0,1 mm | efter makroen |

L og R er heltal i 0,1 mm (188,3 mm → 1883; R1 → 3600). Kontrollér bueformlerne numerisk mod
`C.walkGeo` i en test; brug ikke tabellen ukritisk.

Forskydningen i verden er den lokale forskydning ganget med ζ^k, hvor k er startretningen.

**Makroer** dækker det, der ikke ligger i gitteret undervejs, men lander i det igen. Sporskiftets
gren er 24,28°, så:

- sporskiftets gren + 24224 (modkurve): parallelt spor 77,5 mm til siden, drejning 0,
- sporskiftets gren + 24206: drejning ±1,
- 24224 + 24206 som én 30°-bue i R2.

Beregn en makros forskydning med `C.walkGeo` og afrund x og y til nærmeste 0,1 mm. Afrundingen er
højst 0,05 mm pr. makro; den færdige rute kontrolleres alligevel i decimaltal (afsnit 4, trin 5).

### Funktioner (mindstekrav)

```
add(p, q), sub(p, q), rot(p, k), toXY(p) → {x, y}
key(p, k) → streng til Map-opslag
stepsFor(spare) → skridt lageret kan levere (lige stykker pr. varenummer, buer pr. radius, makroer)
fromPose({x, y, h}) → {p, k} eller null hvis stillingen ikke ligger i gitteret (± 0,05 mm, ± 0,05°)
```

`fromPose` bruges til at oversætte portenes stillinger. Banens første kæde lægges i dag med
vilkårlig decimalforskydning på pladen; vælg derfor gitterets origo og nulretning ud fra
`layout.chains[0].pieces[0].start`, og oversæt alt relativt til det.

## 4. Del B: forbindelsessøgning

Erstat `solve` + `buildLink` i `router.js` med én funktion:

```
connect(A, B, spare, opts) → liste af kandidater { pieces, length, gap }
```

`A` og `B` er porte fra `enumPorts` (uændret). `pieces` har samme form, som `buildLink` giver i
dag (portens ben, mellemstykker med `run`-id på lige stykker, målportens ben spejlvendt), så
`clearPath`, `commit` og resten af `addLinks` kan bruges uændret.

### Algoritme

1. Oversæt `A.pose` og `B.pose` med `fromPose`. Ligger en af dem uden for gitteret, så fald
   tilbage til den gamle `solve` (behold den i filen til det).
2. Bredde-først fra A: tilstand = (position, retning). Udvid med alle skridt fra `stepsFor`.
   Gem pr. tilstand højst 3 veje (færrest skinner først) i en `Map` på `key`.
3. Det samme fra B.
4. En tilstand (p, k) fra A og en (p, k + 6) fra B er et møde: A-vejen efterfulgt af B-vejen
   baglæns er en rute.
5. For hvert møde: saml lagerforbruget fra begge halvdele (plus portenes `need`, minus `free`)
   og kassér, hvis lageret ikke rækker. Byg kæden, kør `layoutChain`, og kræv at enden rammer
   `B.tongue` inden for `GAP_TOL` (1,6 mm) og 0,5°.

### Beskæring (nødvendig for at det bliver hurtigt)

- Positioner uden for pladen (minus margen) udvides ikke.
- Lige stykker efter hinanden lægges i fast rækkefølge efter varenummer, så den samme strækning
  ikke tælles flere gange.
- Højst `opts.depth` skridt pr. side (start med 7) og højst `opts.maxStates` tilstande pr. side
  (start med 60 000).
- Samlet drejning pr. side højst ±7 skridt (210°).
- Ingen skridt, der bruger mere af et varenummer, end lageret har.

### Krav

- Finder alt det, den gamle `solve` finder på gitterstillinger (test: for 200 tilfældige portpar
  på en oval skal `connect` give en kandidat, hver gang `solve` + `buildLink` gør).
- Tidsforbrug pr. portpar: mål det. `addLinks` prøver i dag 2 500 par pr. gennemløb med ca.
  15 µs pr. par; det holder ikke med en søgning pr. par. Lav derfor søgningen fra A **én gang pr.
  port** og genbrug den mod alle B. Mål: et gennemløb af `addLinks` på højst 300 ms på lageret
  "mine", plade 3000 × 1500.

## 5. Del C: grundformen "Fri sløjfe"

Ny topologi `{ id: 'free', name: 'Fri sløjfe', … }` i `topologies.js` med samme `prep`/`attempt`-
grænseflade som de andre.

- En lukket sløjfe er en rute fra en startstilling tilbage til sig selv med samlet drejning ±12
  skridt (360°). Byg den med samme mødes-på-midten-søgning: to halvdele fra startstillingen, den
  ene baglæns.
- Sløjfen behøver ikke være symmetrisk. Den må gerne have højresving (S-kurver, L- og U-form),
  når `o.sCurves` er slået til.
- Lige stykker skal have `run`-id (`C.newRunId()`), så stationer og sporskifter kan lægges på.
- Returnér flere forskellige sløjfer over mange kald (`sig` skal være forskellig for forskellige
  former; `generate` bruger den til at undgå gentagelser).
- Foretræk former, der fylder pladen: højde og bredde tæt på pladens indre mål giver plads til
  ruter indeni.
- `generate` tjekker selv lukning (3 mm), at formen passer på pladen, og `chainsCollide`.
  Topologien skal altså ikke gentage de tjek, men bør ikke aflevere former, der oplagt fejler dem.
- Tilføj `free` til `TOPO_W` i `generator.js` (start med vægt 3) og til standardvalget i
  `app.js` (`state.topologies`).

Bemærk: `symmetryCenter` i `generator.js` giver `null` for usymmetriske former. Så springes
spejlingen af ruter over; det er i orden.

## 6. Praktisk

- Sprog: kommentarer og tekster i brugerfladen er på dansk. Hold den stil.
- Nye filer skal ind tre steder: `<script>`-tags i `static/index.html`, `importScripts` i
  `static/js/worker.js`, og rækkefølgen skal være `core, graph, lattice, topologies, elements,
  router, generator`. Hæv versionsnummeret (`?v=17` → `?v=18`) alle steder, også i `app.js`
  (`js/worker.js?v=…`).
- Projektet er ikke et git-repo. Lav ingen commits.
- Udrulning: `docker compose up -d --build` i projektmappen; siden svarer på port 8261
  (`/healthz`). Gør det først, når afsnit 7 er opfyldt.
- Der er ingen browser til rådighed. Sig det tydeligt i afrapporteringen, hvis siden ikke er
  åbnet i en rigtig browser.

## 7. Test og måling

Værktøj: `tools/bench.js` kører generatoren i Node, kontrollerer sporgraf og lagerforbrug og
tegner de seks bedste baner som PNG (kræver `rsvg-convert`).

```
node tools/bench.js <lager> <B> <H> <antal> <billedpræfiks> [ms pr. bane] [json-indstillinger]
node tools/bench.js mine 3000 1500 8 /tmp/ud_ 2500
tools/montage.sh /tmp/ud_          # samler billederne i /tmp/ud_all.png
```

Lagre: `mine`, `large`, `medium`, `small`. Linjer med `!! GRAF` eller `!! OVERFORBRUG` er fejl.
Hvis `bench.js` skal kende den nye fil eller topologi, så ret listerne øverst i den.

**Før du ændrer noget:** kør tallene nedenfor og gem dem. De er sammenligningsgrundlaget.

| Måling | Hvordan | Krav efter |
|---|---|---|
| Fejl | Alle kørsler i listen nedenfor | Ingen `!! GRAF`, ingen `!! OVERFORBRUG`, ingen undtagelser |
| Skinner brugt | `mine 3000 1500`, 16 baner, median af "brugt/178" | Højere end før; rapportér begge tal |
| Uafhængige ruter | Samme kørsel, median af `routes` | Ikke lavere end før |
| Ekstra sløjfe | `{"elements":{"inner":"must"}}`, 16 baner, andel uden "mangler" | Rapportér før og efter (før: sjældent) |
| Fri sløjfe | `{"topologies":{"free":true}}`, 16 baner | Mindst 12 gyldige baner, mindst 6 forskellige former |
| Tid | `tried=` i udskriften (kandidater pr. bane) | Ikke under det halve af før |

Kørsler, der alle skal være fejlfri:

```
mine 3000 1500      mine 2050 1200      mine 4500 2500
mine 3000 1500 {"allSwitches":true}
large 3000 1500     large 4500 2500 {"allSwitches":true}
medium 2050 1200 {"maximize":false}
small 1600 1000
```

Se billederne igennem. En bane, der består grafkontrollen, kan stadig se forkert ud (spor oven i
hinanden nær sporskifter). Finder du sådan en, så ret frihøjden; slæk ikke på grafkontrollen.

Skriv desuden enhedstest for `lattice.js` (fx `tools/test-lattice.js`, kørt med `node`):

- `rot` 12 gange giver udgangspunktet.
- Hvert skridts forskydning via `toXY` svarer til `C.walkGeo` inden for 0,06 mm.
- 12 × R1 30° venstre ender i origo, eksakt.
- 24188 + 24172 har samme forskydning som en længde på 360 mm, eksakt.
- R2-hjørne på 90° har samme endepunkt som 77,5 mm lige + 3 × R1 30° + 77,5 mm lige, eksakt.

## 8. Rækkefølge og afrapportering

1. Kør målingerne "før".
2. Del A med test.
3. Del B. Kør alle kørsler; sammenlign.
4. Del C. Kør alle kørsler; sammenlign.
5. Udrul.

Afslut med en kort rapport: tallene før og efter i én tabel, hvad der blev lavet, hvad der ikke
blev, og kendte svagheder. Hvis et krav i afsnit 7 ikke kan nås, så stop og beskriv hvorfor med
målinger; lad være med at slække kravet eller omgå kontrollen.
