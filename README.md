# Mängdning – StreamBIM-widget

Widgeten tar fram mängder ur modellen direkt i StreamBIM och exporterar dem till Excel.
Widgeten **läser bara**. Den ändrar aldrig modell, projekt eller egenskaper. Det enda den påverkar är vyn (färg, sökning, dolda objekt och lager), och "Återställ vy" nollställer den.

## Så fungerar den

1. **Disciplin** och **2. Objekttyp** visas direkt, med antal, från StreamBIMs räkning per IFC-klass (`valuesForObjectProperty('@kind')`). Inget läses in i det här läget. Disciplin bestäms av IFC-klassen enligt `discipline.byClass` i settings.
3. **Parametrar.** När en objekttyp är vald hämtas dess GUID:er med `findObjects` och egenskaperna objekt för objekt med `getObjectInfo`.
   - Har urvalet högst `autoLoad` objekt (3 000) läses allt in direkt. Parametrar och värden kommer då från urvalet, med antal, och varje filter visar bara det som finns kvar efter filtren ovanför.
   - Har urvalet fler objekt kommer parametrarna från ett stickprov och värdena från hela modellen. När du väljer ett värde snävas urvalet in på servern med `findObjects`, och när det är litet nog läses det in. Med knappen "Läs in alla" läses hela urvalet in (högst `maxLoad`, 30 000).

Resultatet uppdateras direkt: antal (st), längd (m), area (m²) och volym (m³) från `BaseQuantities` och `Qto_*`, grupperat på IFC-klass, disciplin eller valfri parameter.
En rad i tabellen visar objekten i 3D. "Markera" färgar dem och "Isolera" döljer allt annat.
"Exportera till Excel" skapar `Test_1_Sweco_mängdning_ÅÅÅÅ-MM-DD.xlsx` med en sammanställning och en objektlista.

### Verifierat mot Test 1, Sweco (27 nov)
- `@kind`-värden är skrivna som `Wall` och `Cable carrier segment`. Widgeten visar dem som `IfcWall` och `IfcCableCarrierSegment`.
- `getObjectInfoForSearch` med `filter.rules` ger felet `unknown`. `findObjects({ key: '@kind', value })` fungerar.

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
| 1 | `findObjects` fungerar även för andra egenskaper än `@kind`, med samma nyckel som i objektets `properties` (t.ex. `Platsdata~Zon`). Används bara för stora urval. | Filtret ger 0 objekt. Använd "Läs in alla" eller välj en mindre objekttyp först. |
| 2 | `getObjectInfo` klarar ca 40 parallella anrop. | Inläsningen går långsamt eller fastnar. Sänk `search.batch`. |
| 3 | Kvantiteter finns i `BaseQuantities`/`Qto_*`, i meter, m² och m³. | Varning om saknade kvantiteter. Justera `quantities.scale`. |
| 4 | `applyObjectSearch({ key, value })` fungerar för "Isolera". | Gruppen visas bara i färg. |
| 5 | Widgetrutan tillåter nedladdning. | Inget händer vid export. Det måste StreamBIM ändra. |
