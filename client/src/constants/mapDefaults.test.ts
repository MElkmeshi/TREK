import { describe, it, expect } from 'vitest'
import {
  attributionForTile,
  ESRI_GRAY_ATTRIBUTION,
  ESRI_GRAY_DARK,
  ESRI_GRAY_LIGHT,
  SATELLITE_TILE_ATTRIBUTION,
  SATELLITE_TILE_URL,
  CARTO_LIGHT,
} from './mapDefaults'

describe('attributionForTile', () => {
  it('FE-CONST-MAPDEF-001: credits Esri under an Esri basemap', () => {
    // Printing OpenStreetMap under Esri tiles is both wrong and a licence problem,
    // which is why the host decides rather than a flag at the call site.
    expect(attributionForTile(ESRI_GRAY_LIGHT)).toBe(ESRI_GRAY_ATTRIBUTION)
    expect(attributionForTile(ESRI_GRAY_DARK)).toBe(ESRI_GRAY_ATTRIBUTION)
  })

  it('FE-CONST-MAPDEF-002: keeps the imagery credit for the satellite layer on the same host', () => {
    expect(attributionForTile(SATELLITE_TILE_URL)).toBe(SATELLITE_TILE_ATTRIBUTION)
  })

  it('FE-CONST-MAPDEF-003: everything else stays OpenStreetMap, including no template at all', () => {
    expect(attributionForTile(CARTO_LIGHT)).toMatch(/OpenStreetMap/)
    expect(attributionForTile('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toMatch(/OpenStreetMap/)
    expect(attributionForTile(null)).toMatch(/OpenStreetMap/)
    expect(attributionForTile('')).toMatch(/OpenStreetMap/)
  })

  it('FE-CONST-MAPDEF-004: the Esri templates put the row before the column', () => {
    // Esri is the one provider here that orders the path {z}/{y}/{x}. Getting it
    // wrong yields tiles from the wrong place rather than an error.
    for (const url of [ESRI_GRAY_LIGHT, ESRI_GRAY_DARK, SATELLITE_TILE_URL]) {
      expect(url).toContain('/{z}/{y}/{x}')
      expect(url).not.toContain('/{z}/{x}/{y}')
    }
  })
})
