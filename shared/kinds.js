// StreamBIM:s @kind (engelska, IFC-klass med mellanslag) → svenska namn. Används av Rummet, och av Filter som sökord.
export const KIND = {
  Wall: 'Väggar', 'Curtain wall': 'Glasfasader', Slab: 'Bjälklag', Roof: 'Tak', Door: 'Dörrar', Window: 'Fönster',
  Column: 'Pelare', Beam: 'Balkar', Member: 'Profiler', Plate: 'Skivor', Footing: 'Fundament', Pile: 'Pålar',
  Covering: 'Beklädnad', Railing: 'Räcken', Stair: 'Trappor', 'Stair flight': 'Trapplopp', Ramp: 'Ramper',
  Furniture: 'Möbler', 'Furnishing element': 'Inredning', 'Element assembly': 'Sammansatta element',
  'Mechanical fastener': 'Infästningar', 'Discrete accessory': 'Tillbehör', 'Reinforcing bar': 'Armering',
  'Building element proxy': 'Övriga byggdelar', 'Opening element': 'Öppningar', Space: 'Rum och zoner',
  'Flow terminal': 'Installationer – don', 'Flow segment': 'Installationer – rör/kanal', 'Flow fitting': 'Installationer – delar',
  'Duct segment': 'Kanaler', 'Pipe segment': 'Rör', 'Cable carrier segment': 'Kabelstegar', 'Distribution element': 'Installationer',
  'Cable carrier fitting': 'Kabelstegsdelar', 'Air terminal': 'Ventilationsdon', 'Duct fitting': 'Kanaldelar', 'Pipe fitting': 'Rördelar',
  'Light fixture': 'Armaturer', 'Electric appliance': 'Elapparater', 'System furniture element': 'Systeminredning',
  'Transport element': 'Hissar och transport', Alarm: 'Larm', 'Fire suppression terminal': 'Sprinkler', 'Sanitary terminal': 'Sanitet',
  'Cable segment': 'Kablar', 'Cable fitting': 'Kabeldelar', 'Junction box': 'Kopplingsdosor', Outlet: 'Uttag',
  'Switching device': 'Brytare', 'Valve': 'Ventiler', 'Pump': 'Pumpar', 'Fan': 'Fläktar', 'Damper': 'Spjäll', 'Unitary equipment': 'Aggregat',
};

// Engelskt visningsnamn i plural: 'Wall' → 'Walls', 'Building element proxy' → 'Building element proxies'.
const UNCOUNTABLE = /(furniture|equipment)$/i;
export const plural = (kind = '') => (UNCOUNTABLE.test(kind) ? kind
  : /[^aeiou]y$/.test(kind) ? kind.slice(0, -1) + 'ies'
  : /(s|x|ch|sh)$/.test(kind) ? kind + 'es'
  : kind + 's');
