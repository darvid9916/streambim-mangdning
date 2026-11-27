// Ljust eller mörkt tema för widgetarna. Läggs efter widgetens <style>; widgeten använder färgvariablerna --fg, --muted, --line och --warn.
//
// I StreamBIM ligger widgeten i vänsterpanelen (308 px, mörk och halvgenomskinlig över 3D-vyn). I helskärm blir panelen vit med
// svart text, och på mobil är behållaren också vit (StreamBIM:s app-CSS: .slider-group--expanded .slider, .background--white).
// Därför:
// - bred ram (helskärm, ≥ 720 px) eller ?tema=ljus → ljust tema
// - smal ram → mörkt tema med egen mörk bakgrund, så att texten syns oavsett vad StreamBIM lägger bakom
const forced = new URLSearchParams(location.search).get('tema') === 'ljus';
const wide = matchMedia('(min-width: 720px)');
const apply = () => { document.documentElement.dataset.tema = forced || wide.matches ? 'ljus' : 'mork'; };
apply();
wide.addEventListener('change', apply);
document.head.append(Object.assign(document.createElement('style'), { textContent: `
  :root[data-tema=mork] body { background: #232427; }
  :root[data-tema=ljus] body { background: #fff; }
  :root[data-tema=ljus] { --fg: #1d2228; --muted: rgba(0,0,0,.62); --line: rgba(0,0,0,.14); --warn: #9a5b00; }
  :where(:root[data-tema=ljus]) :where(input, select, textarea) { background: #fff; } /* låg specificitet: widgetens egna regler vinner */
  :root[data-tema=ljus] :is(.row:hover, .row[aria-pressed="true"]) { background: rgba(0,0,0,.06); }
` }));
