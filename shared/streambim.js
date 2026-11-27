// Läser StreamBIM:s riktiga dataformat, verifierat mot projekt 5364 i november 2026 (se README).
//
// getObjectInfo(guid) → {
//   properties: { '@kind', Name, 'Global Id', 'Type Object Global Id': 'T~<guid>', '@Building Storey': { '@iid', Name }, … },
//   groups: [{ label: 'BaseQuantities', content: { properties: [{ key, value: '<text>', unit: 'millimetre', … }] } }, …],
//   spaces: [<rum-/zon-GUID>], floors: [<våningsid>], layer, center, bbox, jobcreated, jobdeleted, …
// }
// getObjectInfoForSearch kräver filter + page + sort och ger { header, data: [{ GUID, Name, 'IFC Type', 'Type Name', Link }], meta: { total } }.

export const TO_METRE = { millimetre: 0.001, centimetre: 0.01, decimetre: 0.1 };

export const guidOf = (info) => info?.properties?.['Global Id'] ?? info?.guid;

// Platta egenskaper: attribut som de är ('@Building Storey' → '@Building Storey~Name'),
// grupper som 'Grupp~Nyckel'. Längder i mm/cm/dm räknas om till meter med StreamBIM:s egen enhetsangivelse.
export function propsOf(info = {}) {
  const out = {};
  for (const [k, v] of Object.entries(info.properties ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) out[`${k}~${k2}`] = v2;
    else out[k] = v;
  }
  for (const g of info.groups ?? []) {
    for (const p of g.content?.properties ?? []) {
      const scale = TO_METRE[p.unit];
      out[`${g.label}~${p.key}`] = scale && p.value !== '' && Number.isFinite(+p.value) ? +p.value * scale : p.value;
    }
  }
  return out;
}

const SORT = { field: 'Name', descending: false };

// Alla sökrader för ett filter, sida för sida. max skyddar mot zoner med tiotusentals objekt.
// fieldUnion: true ger varje rad alla egenskaper ('Grupp~Nyckel', mängder som tal) och header med enheter.
// Verifierat i 5364: 1 941 väggar med 217 egenskaper på 1,5 s. Utan fieldUnion bara GUID, Name, IFC Type, Type Name, Link.
export async function searchRows(api, filter, { max = 3000, page = 500, fieldUnion = false } = {}) {
  const rows = [];
  let total = 0, header = [];
  for (let skip = 0; skip < max; skip += page) {
    const r = await api.getObjectInfoForSearch({ filter, page: { limit: Math.min(page, max - skip), skip }, sort: SORT, fieldUnion });
    total = Number(r?.meta?.total ?? 0);
    header = r?.header ?? header;
    rows.push(...(r?.data ?? []));
    if (!r?.data?.length || rows.length >= total) break;
  }
  return { rows, total, header };
}


// getObjectInfo för många objekt, några parallellt. Misslyckade objekt hoppas över.
export async function infoMany(api, guids, { concurrency = 8, onProgress } = {}) {
  const out = new Array(guids.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < guids.length) {
      const i = next++;
      try { out[i] = await api.getObjectInfo(guids[i]); } catch { out[i] = null; }
      onProgress?.(++done, guids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, guids.length) }, worker));
  return out.filter(Boolean);
}
