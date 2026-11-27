# Mängdning – StreamBIM-widget

Widgeten tar fram mängder ur modellen direkt i StreamBIM och exporterar dem till Excel.
Widgeten **läser bara**. Den ändrar aldrig modell, projekt eller egenskaper. Det enda den påverkar är vyn (färg, sökning, dolda objekt och lager), och "Återställ vy" nollställer den.

## Så fungerar den

När widgeten öppnas läser den in objekten i modellen en gång. Därefter sker allt i steg, och varje steg visar bara det som finns kvar efter de tidigare valen, med antal:

1. **Disciplin.** Hämtas i första hand från den egenskap vars värden matchar StreamBIMs lagernamn. Andra hand är en känd disciplinegenskap (`discipline.keys` i settings). Sist uppskattas den från IFC-klassen. Vilket sätt som användes står under knapparna. Att välja en disciplin som kommer från lager tänder och släcker också lagren i 3D.
2. **Objekttyp.** Bara de IFC-klasser som finns i vald disciplin.
3. **Parametrar.** Bara parametrar och värden som finns i urvalet efter steg 1 och 2 och efter filtren ovanför. Filtren kombineras med OCH.

Resultatet uppdateras direkt: antal (st), längd (m), area (m²) och volym (m³) från `BaseQuantities` och `Qto_*`, grupperat på IFC-klass, disciplin eller valfri parameter.
En rad i tabellen visar objekten i 3D. "Markera" färgar dem och "Isolera" döljer allt annat.
"Exportera till Excel" skapar `Test_1_Sweco_mängdning_ÅÅÅÅ-MM-DD.xlsx` med två flikar: en sammanställning med valen överst och en objektlista.

## Testa lokalt

```bash
cd streambim-mangdning
python3 -m http.server 8000
```
Öppna `http://localhost:8000/?mock=1`. Demoläget efterliknar ett strängt API, så det testar också att söksyntaxen provas fram.

## Felsökning

`"debug": true` i `config/settings.json` visar en mörk ruta längst ner med StreamBIMs råa svar: vilken söksyntax som fungerade, det första objektet, lagren och disciplinfördelningen. Stäng av felsökningen när widgeten fungerar.

## Antaganden som är kvar att verifiera

| # | Antagande | Om det är fel |
|---|---|---|
| 1 | `getObjectInfoForSearch` hittar objekt med en regel på `@kind`. Widgeten provar fyra värdeformat (`Wall`, `IfcWall`, `IFCWALL`, rått värde), med och utan `operator: '='`, och buildingId som text och som tal. | Felmeddelande om att ingen söksyntax hittades. Skicka felsökningsrutan. |
| 2 | Sökningen stöder `page.limit` och `page.skip`. | Bara de första 500 objekten per klass läses in. |
| 3 | Kvantiteter finns i `BaseQuantities`/`Qto_*`, i meter, m² och m³. | Varning om saknade kvantiteter. Ändra `quantities.scale` om värdena är 1 000 gånger för stora. |
| 4 | Lagren i `getLayers()` motsvarar discipliner eller delmodeller och finns som en egenskap på objekten. | Disciplin tas från en egenskap eller från IFC-klass i stället, vilket står i widgeten. |
| 5 | Widgetrutan tillåter nedladdning. | Inget händer vid export. Det måste StreamBIM ändra. |
| 6 | Projektnamnet tas från `projectNames` i settings, eftersom API:t bara ger ett id. | Filnamnet blir `projekt-<id>_…`. |

Max 20 000 objekt läses in (`search.maxObjects`).
