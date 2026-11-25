# Mängdning – StreamBIM-widget

Widgeten tar fram mängder ur modellen direkt i StreamBIM, till exempel antal dörrar per typ, väggarea per våning eller betongvolym per zon. Resultatet kan exporteras till Excel.
Widgeten **läser bara**. Den ändrar aldrig modell, projekt eller egenskaper. Det enda den påverkar är vyn (sökning, färg, kamera), och "Återställ vy" nollställer den.

Samma upplägg som "Mitt område": statisk webbapp utan byggsteg, `connectToParent` mot StreamBIM och demoläge med `?mock=1`.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html`, `app.js`, `styles.css` | Widgeten |
| `config/settings.json` | Klasslista, kvantitetsnamn per klass, sidstorlek, projektnamn |
| `lib/streambim-widget-api.min.js` | StreamBIMs bibliotek v3.0.0 (MIT) |
| `lib/xlsx.full.min.js` | SheetJS 0.18.5 (Apache 2.0) för Excel-export |
| `mock.js` | Demodata: väggar, dörrar, bjälklag och pelare på tre plan och två zoner |

## Så fungerar den

1. **Objekttyper:** tryck på en eller flera IFC-klasser. Listan visar bara klasser som finns i modellen, om API:t kan svara på det.
2. **Filter:** välj egenskap och värde. Egenskaperna läses från ett urval av objekten och värdena från hela modellen. Alla filter måste stämma (OCH). "Rensa filter" tar bort alla.
3. **Omfång:** hela modellen, objekt du har klickat på i 3D, eller synliga lager.
4. **Gruppera på:** IFC-klass eller valfri egenskap. Du får delsummor per grupp och en totalsumma.
5. **Mängda:** hämtar objekten sida för sida och summerar antal (st), längd (m), area (m²) och volym (m³) från `BaseQuantities` och `Qto_*`.
6. **Rad i tabellen:** visar gruppens objekt i 3D. "Markera" tonar ned resten och "Isolera" döljer resten.
7. **Exportera till Excel:** skapar `Test_1_Sweco_mängdning_ÅÅÅÅ-MM-DD.xlsx` med två flikar. Fliken *Sammanställning* har aktiva filter överst och grupperna under. Fliken *Objektlista* har GUID, klass, egenskaper, kvantiteter och vilken kvantitet som användes.

## Testa lokalt

```bash
cd mangd-widget
python3 -m http.server 8000
```
Öppna `http://localhost:8000/?mock=1`. Välj t.ex. IfcWall, IfcDoor och IfcSlab, filtrera på `Building Storey = Plan 3`, gruppera på `Type`, tryck på Mängda och exportera.
Kontroll i demodatan för Plan 3: 22 objekt, betongbjälklag 380 m² och 95 m³, två dörrar utan kvantiteter.

Öppna inte `index.html` genom att dubbelklicka på filen. `fetch` av `config/settings.json` kräver en webbserver.

## Testa mot Test 1, Sweco

1. Publicera på GitHub Pages på samma sätt som "Mitt område", i ett eget repo, t.ex. `streambim-mangdning`. Gör det först när du har godkänt koden.
2. Be StreamBIM (support@rendra.io) att vitlista adressen och slå på den i projectId 5364.
3. Öppna widgeten i StreamBIM och gå igenom antagandena nedan i ordning. Börja med en klass och inga filter.
4. Jämför mängderna med Solibri eller en IFC-läsare för samma modell, t.ex. antal IfcDoor och summa NetSideArea för IfcWall.

## Antaganden att verifiera

Följande står inte i StreamBIMs API-dokumentation, eller är bara antytt där. Allt utom 6 och 7 går att justera i `settings.json` eller på ett ställe i `app.js`.

| # | Antagande | Var det syns om det är fel | Var det justeras |
|---|---|---|---|
| 1 | IFC-klass söks med `propKey: '@kind'` och värden utan Ifc-prefix (`Wall`, `Door`). Det bygger på demokoden i StreamBIMs repo. | 0 objekt för alla klasser | `search.kindKey`, `classes[].kind` |
| 2 | `valuesForObjectProperty('@kind')` returnerar de klasser som finns. | Alla klasser visas, även de som saknas (ofarligt) | – |
| 3 | Regler i samma inre array i `filter.rules` kombineras med OCH. | Filter verkar inte begränsa | `groupRules()` i `app.js` |
| 4 | Yttre arrayen i `filter.rules` kombineras med ELLER. Används **bara** för 3D-vyn när en grupp spänner över flera klasser. Mängderna hämtas med en sökning per klass. | Fel objekt markeras vid gruppering på annat än IFC-klass | `show3D()` |
| 5 | Likhet anges genom att utelämna `operator`, som i README-exemplet med `@kind`. | 0 träffar med filter | `search.equalsOperator` (t.ex. `"="`) |
| 6 | `getObjectInfoForSearch` stöder `page.limit` och `page.skip` och returnerar `properties` som `{ "Pset~Nyckel": [värde] }`. Egenskaper utan pset har bara nyckeln. | Bara de första 500 objekten, eller tomma egenskapslistor | `getProp`/`propVal` (hanterar även nästlat `{Pset: {Nyckel}}`) |
| 7 | Kvantiteter ligger i pset som matchar `^(BaseQuantities\|Qto_.*)$` och anges i meter, m² och m³. Revit exporterar normalt i SI-enheter. | Varning om saknade kvantiteter, eller värden 1 000 eller 1 000 000 gånger för stora | `quantities.psetPattern`, `quantities.scale` |
| 8 | Valet av kvantitet per klass: vägg NetSideArea, bjälklag NetArea, dörr och fönster Area osv. | Fel area för en klass | `quantities.default`, `quantities.byClass` |
| 9 | Objekt-id ligger i `info.guid` (annars `id` eller egenskapen `GUID`). | Tom objektlista | `guidOf()` |
| 10 | "Synliga lager": `getLayers()` returnerar `{lagernamn: synlig}` och objekten har en egenskap med samma lagernamn. Det är det osäkraste antagandet. | Felmeddelande om att lager inte kan avgöras | `layerPropertyCandidates` |
| 11 | "Markerade i 3D" bygger på `pickedObject`-händelsen. Det finns ingen metod för att läsa StreamBIMs egen markering, så widgeten samlar klicken själv. | – | – |
| 12 | StreamBIMs widget-iframe tillåter nedladdning (`allow-downloads`). | Inget händer när du trycker på Exportera | Måste ändras av StreamBIM. Fråga dem. |
| 13 | Projektnamnet går inte att läsa via API:t, så det tas från `projectNames` i settings (5364 → "Test 1, Sweco"). | Filnamnet blir `projekt-5364_…` | `projectNames` |

## Notering om SheetJS

Versionen på npm (0.18.5) har kända sårbarheter vid **inläsning** av filer. Widgeten skriver bara filer, så de berör inte den här användningen. Inför drift kan du byta till senaste versionen från cdn.sheetjs.com: lägg filen i `lib/` med samma namn.
