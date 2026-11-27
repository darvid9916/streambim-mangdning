# Filter – widget för StreamBIM

Sök, filtrera och mängda direkt i StreamBIM: antal, area, längd och volym per våning, typ eller valfri egenskap, med diagram, sparade vyer och export till Excel. Gränssnittet är på engelska.

Widgeten är ren HTML och JavaScript utan byggsteg och utan beroenden. Allt körs i webbläsaren mot StreamBIM:s widget-API ([streambim-widget-api](https://github.com/streambim/streambim-widget-api) v3.0.0, som ingår i `vendor/`).

## Innehåll

```
index.html                 skickar vidare till filter/ (så att repots rotadress fungerar)
filter/index.html          widgeten (sidan som StreamBIM laddar)
filter/logic.js            villkor → StreamBIM:s sökfilter, värdesökning, sparade vyer
shared/streambim.js        läser StreamBIM:s dataformat, bläddrar i sökningar
shared/quantities.js       mängder: area/längd/volym per IFC-typ, gruppering, tabell
shared/xlsx.js             egen .xlsx-export (ingen extern kod)
shared/kinds.js            IFC-typer: svenska sökord och engelska namn
shared/tema.js             ljust tema i helskärm, mörkt i den smala panelen
vendor/                    streambim-widget-api (MIT)
*.test.mjs                 tester, körs med node
```

## Driftsättning

1. Lägg hela mappen, med strukturen intakt, på en webbplats med HTTPS, till exempel GitHub Pages. Widgeten hänvisar till `../shared/` och `../vendor/`, så mapparna måste ligga bredvid varandra.
2. Widgetens adress är mappen `filter/`, till exempel `https://<konto>.github.io/<repo>/filter/`.
3. Lägg upp adressen i projektets widgetlista i StreamBIM, med namnet `Filter`. StreamBIM laddar då sidan i sin vänstra panel.

Inget skickas till någon annan server än StreamBIM. Widgeten sparar två saker i användarens webbläsare (`localStorage`):
- ett register över projektets egenskapsvärden, som gör att man kan söka på värden; det byggs om efter ett dygn;
- användarens sparade vyer per projekt.

## Så används den

- **Sök** på värde, egenskap, typ eller våning, till exempel `GP`, `Rw 38`, `EI30`, `door` eller `Plan 04`. Välj en träff så blir den ett villkor. Värden på samma egenskap räcker var för sig, och villkor på olika egenskaper måste alla stämma.
- **Klicka på ett objekt** i modellen för att filtrera på dess typ, våning eller något annat värde.
- **Resultatet** visas direkt i modellen och som nyckeltal. Diagrammet kan visas som Donut, Bars, Columns eller Table, med inställningarna Show, Group by och Max.
- **Klicka på en del av diagrammet** för att bara se den gruppen, och lägg till den i filtret.
- **Export to Excel** ger två blad: en sammanfattning, och en rad per objekt med mått.
- **Color in model** färgar objekten efter Group by, och StreamBIM visar färgförklaringen.
- **Save view** sparar filtret så att det syns på dashboarden.

## Tester

Kräver Node 22 eller senare:

```
node filter/logic.test.mjs
node shared/quantities.test.mjs
node shared/xlsx.test.mjs
```

## Bra att veta om StreamBIM:s API

Följande är verifierat mot ett riktigt projekt. Där StreamBIM:s dokumentation inte räckte är det läst ur StreamBIM:s egen app-kod.

- **`getObjectInfoForSearch({ …, fieldUnion: true })`** ger alla egenskaper och mängder per rad, och ett sökhuvud med enheter. Mängderna hämtas på det sättet: ungefär 1 300 objekt per sekund. Med `getObjectInfo` går det ungefär 70 objekt per sekund.
- **`applyObjectSearch`** tar filtret direkt, alltså `{ rules }`, inte `{ filter }`.
- **Våning är `Location~Floor by position`.** Den har ett värde per objekt och går att söka och färga på. `Floor Id` kan ge ett objekt flera våningar.
- **`colorCodeByProperty`:**
  - den kräver en färdig sökning;
  - ett nytt anrop med samma egenskap stänger av färgningen;
  - `colorCodeByProperty({})` tar bort färgningen.
- **`colorCodeObjects`** med egna färger visas bara som StreamBIM:s gröna markering, så den används inte.
- **`deHighlightAllObjects`** svarar aldrig och får inte inväntas.

## Antaganden, ej verifierade i StreamBIM:s riktiga widgetpanel

Widgeten är utvecklad mot StreamBIM inbäddat i en testsida som härmar panelen. Testsidan har samma API, samma bredd (308 px) och helskärm. Följande är antaget:

- **Nedladdningar är tillåtna i StreamBIM:s widgetram.** Om Export to Excel inte sparar något finns Copy table kvar.
- **Panelen blir vit i helskärm.** Det framgår av StreamBIM:s CSS, och widgeten byter då till ljust tema.

## Licenser

- **streambim-widget-api:** MIT (Rendra AS), <https://github.com/streambim/streambim-widget-api>.
- **Övrig kod:** skriven för det här projektet.
