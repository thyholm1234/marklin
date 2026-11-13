# Spec: generator v2 – søgning i stedet for genstart

Opgave til en udvikleragent. Læs hele dokumentet, `SPEC-gittermotor.md` afsnit 1 (kodeoversigt og
datamodel) og kommentarerne øverst i `generator.js`, `router.js` og `lattice.js`, før du skriver kode.

## 1. Baggrund

`MK.generate` (`static/js/generator.js`) bygger en bane i to faser: fase 1 finder mange gyldige
grundformer, fase 2 tager dem én ad gangen, vokser dem, lægger elementer på (stationer, ruter,
blindspor) og giver point. Den bedste bane vinder. Web Workeren kalder `generate` igen og igen
med ny seed, og hver bane vises i listen.

Banerne er gyldige, men generatoren udnytter tiden dårligt. Målt 13.11.2026 med
`node tools/bench.js mine 3000 1500 8 <præfiks> 2500` (Node 18, 4 kerner):

| Måling | Værdi |
|---|---|
| Færdige kandidater pr. bane (`tried=`) | 5–9, median 6 |
| Skinner brugt med "flest skinner" slået til | 50–74 af 178, median 59 |
| Point | 1450–2168, median ca. 1880 |
| Tid pr. bane ved budget 2500 ms | op til 2917 ms; med `free` 4273 ms; med forbudsområde 4564 ms |
| Fase 1 | 750 ms (30 % af budgettet), giver 60–130 gyldige grundformer, hvoraf 5–9 bruges |
| `link` (ruteløseren) pr. bane | 200–1150 ms |
| `inner` (ekstra sløjfe) pr. bane | 400–3000 ms, lykkes sjældent |
| Uden `link` og `inner` | `tried=` 14–51 |
| CPU-profil | 73 % i V8's egen kode (allokering og oprydning), ikke i projektets funktioner |
| Med forbudsområde (rektangel 1000 × 600 i et hjørne) | `tried=` 3–4; ottetal gav fejl |

Enkeltoperationer på en bane med 74 skinner (2 kæder, 560 prøvepunkter):

| Operation | Tid |
|---|---|
| `structuredClone(layout)` | 1,9 ms |
| `chainsCollide` | 0,62 ms |
| `enumPorts` | 0,53 ms |
| `graph.analyze` | 0,30 ms |
| `layoutChain` for alle kæder | 0,07 ms |

### Årsagerne

1. **Genstart uden hukommelse.** Hver kandidat bygges fra bunden. Det dyre arbejde (vækst, ruter)
   kasseres, når kandidaten taber, og intet læres fra kandidat til kandidat eller fra et
   `generate`-kald til det næste. Fase 1 gentages i hvert kald.
2. **Ingen tidsdisciplin.** Elementerne kender ikke tidsgrænsen. `addExtraLoop` og `addLinks`
   kører til de er færdige, så budgettet overskrides med op til 83 %.
3. **Faste sandsynligheder.** Hvilke elementer der prøves, i hvilken rækkefølge og hvor meget der
   vokses, afgøres af konstanter (`sometimes`, `0.65`, `[0, 0.15, 0.35, 0.6, 1]`). Dyre valg, der
   sjældent betaler sig på det aktuelle lager og den aktuelle plade, bliver ved med at blive prøvet.
4. **Hvert element prøves én gang.** Når pipelinen er kørt igennem, stopper arbejdet på banen,
   selv om to tredjedele af lageret er ubrugt.
5. **Én kerne.** Siden bruger én worker.
6. **Allokering.** Strengnøgler i `Grid`, `structuredClone` og et objekt pr. prøvepunkt holder
   oprydningen i gang.

### Idéen

Byg generatoren om fra "mange uafhængige forsøg" til én vedvarende søgning:

- en **session**, der lever på tværs af kald og husker grundformer, statistik og de bedste baner,
- et **søgetræ med kontrolpunkter**, så en dyr mellemtilstand kan fortsættes på flere måder,
- **adaptivt valg** af, hvad der prøves, ud fra hvad der har givet point pr. millisekund,
- en **forbedringsfase**, der bliver ved med at lægge på den bedste bane, så længe det giver point,
- **flere workere**, der søger hver sin del.

## 2. Mål og afgrænsning

**Skal leveres**

- A. Målegrundlag og tidsdisciplin (afsnit 3).
- B. Hurtigere kerne uden ændret opførsel (afsnit 4).
- C. `MK.createSession` med søgetræ, adaptivt valg, forbedringsfase og arkiv (afsnit 5).
- D. Flere workere i brugerfladen (afsnit 6).
- E. Målinger før og efter (afsnit 8).

**Skal ikke ændres**

- `graph.js` er dommeren. Rør ikke filen. Enhver bane, der returneres, skal have
  `MK.graph.analyze(layout).problems` tom og intet varenummer brugt ud over lageret. Kontrollen
  i `generate` (sikkerhedsnettet før `scoreLayout`) skal blive.
- Pointvægtene `W8` og `scoreLayout`. De er aftalt med brugeren, og de gør point før og efter
  sammenlignelige. Tillægget for forbudsområder (`parts.freeSpace`) regnes som en del af pointene
  og ændres heller ikke.
- Elementernes geometri (`elements.js`, `addCornerCross`, portene i `enumPorts`). De må få en
  tidsgrænse og hurtigere hjælpefunktioner, men skal lægge de samme skinner.
- Resultatformatet fra `generate` (felterne i `return` nederst i `generator.js`). Nye felter må
  tilføjes.
- Kort tilstand (hverken `maximize` eller `allSwitches`, budget 900 ms) skal opføre sig som i
  dag: én hurtig bane med variation. Den må gerne blive hurtigere, ikke langsommere.

**Uden for opgaven**

- Nye grundformer, nye elementer, 15°-kurver i gittersøgningen.
- At fjerne et enkelt element fra en færdig bane. Der findes ingen generel fortrydelse; brug
  kontrolpunkter (afsnit 5.2) i stedet.
- Ændringer i brugerfladen ud over afsnit 6.

## 3. Del A: målegrundlag og tidsdisciplin

### 3.1 Målinger før

Kør tabellen i afsnit 8 på den uændrede kode og gem udskriften i `tools/baseline-v2.txt`. Tallene
i afsnit 1 er vejledende; dine egne målinger på din maskine er sammenligningsgrundlaget.

Udvid `tools/bench.js`, så den slutter med én opsummeringslinje:

```
SUM n=16 fejl=0 point(median/bedst)=1880/2168 skinner(median)=59 tried(median)=6 ms(median/maks)=2700/2917
```

`fejl` tæller linjer med `ERR`, `!! GRAF` og `!! OVERFORBRUG`.

### 3.2 Tidsgrænse i alle elementer

- `generate` lægger `o.deadline` (absolut tid i ms) på indstillingerne.
- Før hvert element beregnes en delfrist: `min(o.deadline, nu + andel)`, hvor andelen er højst
  25 % af det samlede budget for `inner` og `link` og 10 % for øvrige. Delfristen sendes som
  `o.until` (kopiér `o`; muter ikke det fælles objekt).
- `addLinks`, `addExtraLoop`, `makeIndex`, løkken over den gamle løser (`solve`) og
  `fillSwitches` skal afbryde, når `Date.now() > o.until`, og efterlade banen gyldig. Et
  afbrudt element returnerer det antal, det nåede.
- `Date.now()` i en inderløkke tjekkes højst hver 16. iteration.

**Krav:** ingen kørsel i afsnit 8 må bruge mere end 110 % af `timeBudget`.

## 4. Del B: hurtigere kerne

Ingen af punkterne må ændre, hvilke baner der er gyldige. Kontrollér hvert punkt for sig med
`tools/test-connect.js`, `tools/test-lattice.js` og en fejlfri kørsel af afsnit 8, og mål
gevinsten med et lille script (samme form som tabellen i afsnit 1). Rækkefølgen er prioriteret.

1. **Kloning.** Erstat `structuredClone` i `generator.js` og `router.js` (`addExtraLoop`) med
   `C.cloneLayout(layout)` / `C.cloneChains(chains)` i `core.js`: håndskrevne løkker, der
   kopierer kæder, stykker (`geo`, `branch` og `start`/`end`/`pts` dybt) og sidespor.
   `structuredClone` bevarer delte referencer (et stykkes `start` er forrige stykkes `end`;
   `c.start` er `chains[c.attach].end`); kør derfor `relayout` efter kloning, eller genskab
   delingen eksplicit. Skriv en test, der sammenligner klon og original felt for felt og viser,
   at ændringer i klonen ikke rammer originalen. Mål: mindst 5 gange hurtigere end 1,9 ms.
2. **`Grid` med talnøgler.** `C.Grid` bygger en streng pr. opslag og laver ni opslag pr. `near`.
   Brug `(cx + 32768) * 65536 + (cy + 32768)` som nøgle. `graph.js` har sit eget gitter og røres
   ikke.
3. **Kollision under vækst.** `growLayout` kalder `fitsOf` + `chainsCollide` (ca. 1 ms) efter hver
   indsættelse. Tjek først det billige (lukning, omskreven kasse) og kollisionen sidst. Byg ikke
   mellemlister med `flatMap` + `map` i `fitsOf`; regn kassen direkte i to løkker.
4. **Forbudsområder.** `placementFor` regner `spaceCoverage` og `freeSpaceCoverage` for hver
   forskydning, og `freeSpaceCoverage` gennemløber alle punkter for hver fri celle. Byg listen af
   frie celler én gang pr. `generate` (den afhænger kun af `o`), og læg punkterne i et `Grid`, så
   en celle kun ser på punkter i nærheden. Resultatet skal være det samme tal som i dag (test det
   på 20 tilfældige punktsæt).
5. **Prøvepunkter.** `walkGeo` regner sinus og cosinus for hvert punkt. Gem pr. geometri (nøgle:
   type, radius, vinkel, retning, længde, skridt) de lokale punkter fra origo i retning 0, og
   flyt dem med én drejning og forskydning. Punkterne skal stadig være objekter `{x, y, h}`;
   resten af koden læser dem sådan. Kræv højst 1e-9 mm afvigelse fra den gamle beregning.
6. **Profilér igen** (`node --prof tools/bench.js …`, `node --prof-process`), når 1–5 er lavet,
   og tag de tre tungeste poster, der er tilbage. Skriv i rapporten, hvad de var.

## 5. Del C: sessionen

Ny fil `static/js/search.js` (samme modulmønster, eksporteres som `MK.search`), indlæst efter
`generator.js`. `generator.js` beholder byggeklodserne (`growLayout`, `addStems`, `scoreLayout`,
`placementFor`, `fitsOf`, `makeTf`, `symmetryCenter`); eksportér dem, der mangler, via
`MK.compose`. Del fase 2's løkkekrop op i navngivne funktioner (afsnit 5.2), som både `generate`
og sessionen bruger, så der kun findes én udgave af hvert trin.

### 5.1 Grænseflade

```
const s = MK.createSession(inv, opts)     // samme opts som generate; opts.seed styrer alt tilfældigt
s.next(ms)  → resultat som generate, eller { error }
s.stats()   → { iterations, nodes, archive:[{ key, score }], arms:[{ id, n, mean, msMean }] }
```

- `s.next(ms)` arbejder i højst `ms` og returnerer den bedste bane, der ikke er returneret før
  (afsnit 5.5). Sessionens tilstand bliver stående til næste kald.
- `MK.generate(inv, opts)` bliver `createSession(inv, opts).next(opts.timeBudget)`, når
  `maximize` eller `allSwitches` er slået til. Kort tilstand beholder den nuværende kode.
- Sessionen må ikke læse uret til andet end tidsgrænser. Alle valg tages med sessionens `rng`.

### 5.2 Trin og kontrolpunkter

En bane bygges i trin. Efter hvert trin er banen en selvstændig tilstand, der kan klones
(`C.cloneLayout`) og fortsættes på flere måder:

| Trin | Indhold (eksisterende kode) | Valg, der tages |
|---|---|---|
| T0 | Grundform fra `topologi.attempt`, lukket, passer på pladen, kollisionsfri | grundform, ring ja/nej |
| T1 | `growLayout` + evt. `addStems`, ny placering (`fitsOf`, `placementFor`), lagt på pladen | vækstandel, stammer ja/nej |
| T2 | Ringe forbundet (`addCornerCross`, `crossover`), løse ringe fjernet | antal hjørneforbindelser |
| T3 | 'Skal'-elementer og `addStation` | ruter før eller efter stationer |
| T4 | Ruter og stationer ('Kan'): `cutoff`, `wye`, `stub`, `link`, `inner`, stationselementerne | hvilke elementer, rækkefølge |
| T5 | `threeway`, `csiding`, `siding`, `fillSwitches` | rækkefølge |

En **knude** er `{ trin, layout, used, station, valg, point, ms, forælder }`. `point` er
`scoreLayout(...).total` på knudens bane, regnet som i dag (inklusive `parts.freeSpace`). En knude
er kun gyldig, hvis sikkerhedsnettet består (ingen grafproblemer bortset fra, at ringe før T2
endnu ikke er forbundet; intet overforbrug; fri af forbudsområder). Knuder på T5 er færdige baner.

Rækkefølgen inden for T3–T5 følger reglerne i den nuværende løkke (`order`, `stations`,
`routes`, `stemmed`). Flyt dem; opfind ikke nye.

### 5.3 Søgningen

Sessionen holder en **stråle** pr. trin: de bedste `B` knuder (start med `B = 6` for T1–T4), med
højst to knuder fra samme grundform (`sig`), så strålen ikke klapper sammen om én form.

Én iteration:

1. Vælg trin at udvide. Start med fordelingen T0→T1 30 %, T1→T2→T3 20 %, T3→T4 30 %, T4→T5 20 %,
   og spring trin over, hvis strålen før det er tom.
2. Vælg en knude i strålen med sandsynlighed efter rang (bedste dobbelt så ofte som nr. 3).
3. Klon knuden, tag trinnets valg (afsnit 5.4), kør trinnet med delfrist (afsnit 3.2).
4. Gyldig → læg den nye knude i næste stråle; ugyldig → kassér og tæl det.
5. Færdig bane → arkivet (afsnit 5.5) og forbedringsfasen (afsnit 5.6).

**Grundformer (T0):** sessionen holder en pulje af grundformer, bygget med fase 1's kode og
forsortering (`f.score`). Første `next`-kald bruger højst 10 % af sin tid eller til 24 forskellige
grundformer er fundet, hvad der kommer først. Senere kald bruger højst 5 % på at udvide puljen.
Puljen genbruges i hele sessionen.

**Tidlig stop af svage grene:** en knude på T3 eller T4 lægges ikke i strålen, hvis dens point
plus den største gevinst, der er set i sessionen fra det trin til en færdig bane, er lavere end
den dårligste bane i arkivet. Reglen gælder først, når arkivet har 4 baner.

### 5.4 Adaptivt valg

Hvert valg i tabellen i afsnit 5.2 er en **arm**: grundform, vækstandel (5 spande), stammer,
ruter før/efter, og for hvert 'Kan'-element om det prøves. Sessionen fører pr. arm antal forsøg,
samlet gevinst og samlet tid.

- **Gevinst** for en arm = point for knuden efter trinnet minus point for knuden før, delt med
  1000 og klippet til [0, 1]. For T0–T1, hvor point næsten kun er skinneantal, bruges i stedet
  den bedste færdige bane, der senere nedstammer fra knuden (opdateres, når den findes).
- **Valg** med Thompson-trækning: træk for hver arm fra en Beta-fordeling med parametre
  (1 + sum af gevinst, 1 + forsøg − sum af gevinst), del med armens gennemsnitstid i forhold til
  den billigste arm i samme valg (dog højst en faktor 4), og tag den højeste. For ja/nej-valg er
  de to arme "prøv" og "spring over".
- **Bund:** enhver arm vælges med mindst 5 % sandsynlighed, så intet lukkes for altid.
- **Start:** armene begynder med de nuværende sandsynligheder som forhåndsviden (fx
  `el.sometimes = 0.4` → Beta(2, 3)), så de første iterationer ligner den nuværende generator.
- 'Skal'-elementer og 'Fra'-elementer er ikke arme. `mode(id)` bestemmer som i dag.

En Beta-trækning kan laves af to Gamma-trækninger (Marsaglia–Tsang) med sessionens `rng`. Læg
den i `core.js` med en test af middelværdien.

### 5.5 Arkiv og hvad `next` returnerer

Arkivet har én plads pr. **niche**: grundform-id × antal ringe (0, 1, 2) × vending (`an.reverse`
0, 1, 2). Hver plads holder nichens bedste bane. Det sikrer, at listen i brugerfladen får
forskellige banetyper og ikke 20 udgaver af den samme oval.

`next(ms)` returnerer efter tiden den bedste bane i arkivet, der

- ikke er returneret før, eller
- er mindst 3 % bedre end den bane, der sidst blev returneret fra samme niche. Så sættes
  `replaces` til den tidligere banes `id`.

Hvert resultat får `id` (løbenummer i sessionen) og `niche` (strengen). Er der intet nyt at
returnere, arbejder `next` videre i op til 50 % ekstra tid og returnerer ellers
`{ error: null, idle: true }`, som kalderen ignorerer.

`opts.avoid` (signaturer, der allerede er vist) bruges som i dag: baner med en undgået `sig`
vælges kun, hvis der ikke er andre.

### 5.6 Forbedringsfasen

Når en færdig bane kommer i arkivet, og mellem iterationerne (20 % af sessionens tid, når arkivet
ikke er tomt), forbedres en bane fra arkivet, valgt efter rang:

1. Klon banen.
2. Vælg en tilføjelse med en arm pr. slags (afsnit 5.4): `link` (én rute), `siding`, `csiding`,
   `threeway`, `passing`, `cpassing`, `spassing`, `cutoff`, `stub`, `fillSwitches` (kun med
   `allSwitches`). Elementer med `mode(id) === 'off'` er ikke med.
3. Kør den med delfrist. Kør sikkerhedsnettet og `scoreLayout`.
4. Højere point → erstat banen i arkivet (samme niche, eller den nye niche hvis vendingen
   ændrede sig). Ellers kassér klonen.
5. Stop med en bane, når 8 forsøg i træk ikke har forbedret den; markér den som mættet, og vælg
   den ikke igen.

Spærringen `used[id]` i `tryEl` (et element prøves kun én gang) gælder ikke her. Tjek, at hvert
element tåler at blive kaldt flere gange på samme bane; det, der ikke gør, tages ud af listen og
nævnes i rapporten.

### 5.7 Symmetri

`layout.sym` (punktsymmetri) sættes i dag efter T1 og bruges af `addLinks` til at spejle ruter.
Behold det, og genberegn `sym` efter kloning (feltet er et punkt og kan kopieres).

## 6. Del D: flere workere

`static/js/app.js` og `static/js/worker.js`:

- Start `n = min(6, max(1, (navigator.hardwareConcurrency || 2) − 1))` workere. Hver får samme
  lager og indstillinger, men seed `seed + i · 7919`.
- Workeren opretter én session pr. grundform, der er valgt i brugerfladen, og kalder `next` på
  dem på skift (det erstatter `topoFor`). Worker `i` begynder med grundform nr. `i`, så alle
  typer kommer hurtigt på skærmen.
- Hovedtråden samler resultaterne. Et resultat med `replaces` erstatter den tidligere bane fra
  samme worker med det `id`, hvis den stadig er i listen, og beholder dens nummer; ellers lægges
  det til. `idle`-svar ignoreres.
- Hovedtråden sender viste signaturer rundt: efter hvert resultat sendes
  `{ cmd: 'avoid', sig }` til de andre workere, som lægger den i deres sessions `avoid`.
- `stop` afslutter alle workere. Faldet tilbage uden worker (`newWorker()` giver `false`) bruger
  én session på hovedtråden med `next(RUN_MS)` og pauser som i dag.
- Fejl i én worker stopper ikke de andre. Først når alle er døde, vises fejlbeskeden.
- Statuslinjen viser antal workere.

Nye filer skal ind tre steder: `<script>`-tags i `static/index.html`, `importScripts` i
`worker.js` (rækkefølge: `core, graph, lattice, topologies, elements, router, generator,
search`) og `MKFILES`-standarden i `tools/bench.js`. Hæv versionsstrengen (`?v=…`) alle steder,
også i `app.js` (`js/worker.js?v=…`).

## 7. Praktisk

- Sprog: kommentarer og tekster i brugerfladen er på dansk. Hold den stil.
- Ren JavaScript, intet byggetrin, ingen afhængigheder. Koden skal køre i browser og i Node 18.
- Projektet er et git-repo. Arbejd på en gren (`generator-v2`), og lav én commit pr. del
  (A, B, C, D). Push ikke.
- Udrulning (`docker compose up -d --build`, port 8261, `/healthz`) først, når afsnit 8 er
  opfyldt, og kun hvis brugeren beder om det.
- Der er ingen browser til rådighed. Del D kan derfor kun afprøves indirekte: skriv
  `tools/test-session.js`, der kører to sessioner i Node med forskellig seed, sender `avoid`
  imellem dem som hovedtråden ville, og kontrollerer `replaces`-logikken. Sig tydeligt i
  rapporten, at siden ikke er åbnet i en rigtig browser.

## 8. Test og måling

`tools/bench.js` kalder `MK.generate` én gang pr. bane. Tilføj `tools/bench-session.js` med samme
argumenter plus en samlet tid: den opretter sessioner som workeren (én pr. grundform, på skift),
kalder `next(ms)` til tiden er gået, kontrollerer hver bane som `bench.js` og skriver samme
`SUM`-linje samt point for den bedste bane efter 5, 10, 20 og 30 sekunder.

Kørsler, der alle skal være fejlfri (ingen `ERR`, `!! GRAF`, `!! OVERFORBRUG`, ingen
undtagelser), 16 baner hver, 2500 ms hvor andet ikke står:

```
mine 3000 1500      mine 2050 1200      mine 4500 2500
mine 3000 1500 {"allSwitches":true}
mine 3000 1500 {"topologies":{"free":true}}
mine 3000 1500 {"elements":{"inner":"must"}}
mine 3000 1500 {"areas":[[{"x":2000,"y":900},{"x":3000,"y":900},{"x":3000,"y":1500},{"x":2000,"y":1500}]]}
large 3000 1500     large 4500 2500 {"allSwitches":true}
medium 2050 1200 900 {"maximize":false}
small 1600 1000
```

To undtagelser fra "ingen `ERR`": ottetal med forbudsområdet fejler i dag (ingen plads) og må
blive ved med det; `inner: must` må give "mangler", men ikke flere gange end før.

| Måling | Hvordan | Krav efter |
|---|---|---|
| Fejl | Alle kørsler ovenfor | Som beskrevet |
| Tidsdisciplin | `ms(maks)` i alle kørsler | Højst 110 % af budgettet |
| Point, én kerne, samme tid | `mine 3000 1500`, 16 baner, `point(median)` | Mindst 15 % over før |
| Skinner brugt | Samme kørsel, `skinner(median)` | Mindst 25 % over før |
| Gennemløb | Samme kørsel: færdige baner (knuder på T5 plus forsøg i forbedringsfasen) pr. `next`-kald, sammenlignet med `tried(median)` før | Mindst 3 gange før |
| Forbudsområde | Kørslen med `areas`, `point(median)` | Ikke lavere end før; `tried` mindst 2 gange før |
| Vedvarende søgning | `bench-session.js mine 3000 1500`, 30 s: bedste point | Efter 10 s over bedste af 16 baner før; efter 30 s højere end efter 10 s |
| Variation | Samme 30 s: antal forskellige nicher returneret | Mindst 6 |
| Kort tilstand | `medium 2050 1200 900 {"maximize":false}` | Fejlfri, `ms(median)` ikke højere end før |
| Læring | `s.stats().arms` efter 30 s på `mine 3000 1500` | Mindst én arm under 15 % og én over 60 % af sine valg; skriv tabellen i rapporten |

Se billederne igennem (`tools/montage.sh`). Flere skinner på pladen giver flere steder, hvor to
spor kan komme for tæt på hinanden uden at grafkontrollen ser det. Finder du sådan en bane, så
ret frihøjden i det element, der lagde sporet; slæk ikke på kontrollen.

Enhedstest (kørt med `node`): kloning (4.1), `Grid` (samme svar som den gamle på 1000 tilfældige
opslag), prøvepunkter (4.5), Beta-trækning (5.4), og at to sessioner med samme seed og et fast
antal iterationer i stedet for tid (`opts.maxIterations`, kun til test; delfrister slås fra)
giver samme bane.

## 9. Rækkefølge og afrapportering

1. Målinger før (3.1). Commit.
2. Tidsdisciplin (3.2). Kør alle kørsler.
3. Del B, ét punkt ad gangen med måling.
4. Del C: først opdelingen i trin med uændret opførsel (kør alle kørsler og sammenlign med 2),
   så sessionen med stråle (5.3), så adaptivt valg (5.4), arkiv (5.5), forbedringsfase (5.6).
   Mål efter hvert skridt, så det kan ses, hvad hvert skridt gav.
5. Del D.
6. Målinger efter.

Afslut med en kort rapport: tallene før og efter i én tabel, gevinsten pr. skridt i punkt 4,
armtabellen, hvad der blev lavet, hvad der ikke blev, og kendte svagheder. Kan et krav i
afsnit 8 ikke nås, så stop og beskriv hvorfor med målinger. Slæk ikke kravet, ændr ikke `W8`,
og omgå ikke grafkontrollen for at nå det.
