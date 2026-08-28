export const DEFAULT_MAP_LAT = 0
export const DEFAULT_MAP_LNG = 0
export const DEFAULT_MAP_ZOOM = 2
export const DEFAULT_MAP_CENTER: [number, number] = [DEFAULT_MAP_LAT, DEFAULT_MAP_LNG]

// Tokenless satellite base layer (ESRI World Imagery) — works without an API key.
export const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_TILE_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics'
export const SATELLITE_TILE_MAXZOOM = 19

// Esri's grey canvas, on the same keyless legacy host the satellite layer already
// uses. Offered as an alternative to CARTO, whose keyless tiles carry an
// "API KEY REQUIRED" watermark since 26.08.2026 and now need a key the operator
// has to request by mail.
//
// Note the {z}/{y}/{x} order: Esri puts the row before the column, unlike every
// other template here. The base carries no place names; Esri serves those as a
// separate transparent overlay, which a single tile-url setting cannot express,
// so these read as label-free basemaps for now.
export const ESRI_GRAY_LIGHT =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
export const ESRI_GRAY_DARK =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
export const ESRI_GRAY_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ'

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/**
 * Attribution for whatever template a map ended up with. Esri asks for its own
 * credit, and printing OpenStreetMap under an Esri basemap is both wrong and a
 * licence problem, so the host decides rather than a flag at the call site.
 */
export function attributionForTile(url: string | null | undefined): string {
  if (!url) return OSM_ATTRIBUTION
  if (url.includes('arcgisonline.com')) {
    return url.includes('World_Imagery') ? SATELLITE_TILE_ATTRIBUTION : ESRI_GRAY_ATTRIBUTION
  }
  return OSM_ATTRIBUTION
}

// CARTO basemaps. Keyless tiles carry an "API KEY REQUIRED" watermark since
// 26.08.2026, so these are always passed through withTileApiKey() (#2054).
export const CARTO_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
export const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
export const CARTO_LIGHT_NOLABELS = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
export const CARTO_DARK_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
export const CARTO_VOYAGER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
