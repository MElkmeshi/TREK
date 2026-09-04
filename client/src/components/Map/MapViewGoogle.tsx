import { useEffect, useRef, useState } from 'react'
import type { Place } from '../../types'
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../constants/mapDefaults'
import { computeMapViewport, TILE_SIZE_RASTER } from '../../utils/mapViewport'
import { loadGoogleMaps, type GoogleMapsApi } from './engines/google'
import { createMarkerElement } from './placeMarkerElement'
import { buildPlacePopupHtml } from './placePopup'
import { usePlacePhotos, placePhotoUrl } from './usePlacePhotos'
import { toCompassMap } from './googleCompass'

/**
 * The Google Maps renderer.
 *
 * A separate component rather than another engine behind MapViewGL: mapbox-gl
 * and maplibre-gl share one API surface, which is why they share one component
 * and take the engine as a prop. Google's API is a different shape — no style
 * spec, no addSource/addLayer, its own marker and camera model — so it gets its
 * own component and reuses the shared pieces (the pin element, the popup HTML,
 * the viewport maths) rather than a shared map body.
 */
interface Props {
  places: Place[]
  dayPlaces?: Place[]
  route?: [number, number][][] | null
  selectedPlaceId?: number | null
  onMarkerClick?: (id: number) => void
  onMapClick?: (info: { latlng: { lat: number; lng: number } }) => void
  center?: [number, number]
  zoom?: number
  fitKey?: number | null
  dayOrderMap?: Record<number, number[] | null>
  apiKey: string
  language?: string
  /** Receives the compass-shaped view of the map, matching the GL renderers. */
  onMapReady?: (map: ReturnType<typeof toCompassMap> | null) => void
}

export function MapViewGoogle({
  places,
  dayPlaces,
  route,
  selectedPlaceId,
  onMarkerClick,
  onMapClick,
  center,
  zoom,
  fitKey,
  dayOrderMap,
  apiKey,
  language,
  onMapReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const apiRef = useRef<GoogleMapsApi | null>(null)
  const markersRef = useRef<Map<number, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const linesRef = useRef<google.maps.Polyline[]>([])
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Most places carry no image of their own — the pin picture comes from the
  // photo service's cache, which fills in asynchronously.
  const photoUrls = usePlacePhotos(places)
  // The map is built asynchronously. Without this, the marker/route/fit
  // effects run once against a null map and never again, so a trip opened
  // straight onto the planner drew no pins at all.
  const [ready, setReady] = useState(false)

  // Callbacks are read through a ref so the map is built once: rebuilding it on
  // every parent render would refetch tiles, and Google bills per map load.
  const handlersRef = useRef({ onMarkerClick, onMapClick, onMapReady })
  handlersRef.current = { onMarkerClick, onMapClick, onMapReady }

  // The opening view. Held in a ref for the same reason, and so the deps below
  // stay honest rather than being silenced with an exhaustive-deps disable:
  // these are read once, at construction, and every later change is applied by
  // the marker/route/fit effects against the live map.
  const initialViewRef = useRef({ places, dayPlaces, center, zoom })
  initialViewRef.current = { places, dayPlaces, center, zoom }

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    loadGoogleMaps(apiKey, language)
      .then(api => {
        if (cancelled || !containerRef.current) return
        apiRef.current = api

        const view = initialViewRef.current
        const framed = computeMapViewport(view.dayPlaces?.length ? view.dayPlaces : view.places, {
          // Google measures zoom against a 256px world tile, like Leaflet — its
          // own tile requests carry 4i256. The GL scheme would open a level out.
          tileSize: TILE_SIZE_RASTER,
        })
        const initial = framed ?? {
          center: view.center ?? DEFAULT_MAP_CENTER,
          zoom: view.zoom ?? DEFAULT_MAP_ZOOM,
        }

        const map = new api.Map(containerRef.current, {
          center: { lat: initial.center[0], lng: initial.center[1] },
          zoom: initial.zoom,
          // A map id is what enables vector rendering and AdvancedMarkerElement.
          // DEMO_MAP_ID works without cloud styling, which is what a self-hosted
          // instance has unless its operator sets one up.
          mapId: 'DEMO_MAP_ID',
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        })
        mapRef.current = map
        infoRef.current = new api.InfoWindow({ disableAutoPan: true })
        setReady(true)

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return
          handlersRef.current.onMapClick?.({
            latlng: { lat: e.latLng.lat(), lng: e.latLng.lng() },
          })
        })

        handlersRef.current.onMapReady?.(toCompassMap(map))
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })

    return () => {
      cancelled = true
      setReady(false)
      handlersRef.current.onMapReady?.(null)
      mapRef.current = null
    }
  }, [apiKey, language])

  // Markers — diffed against the live map rather than torn down, so panning
  // does not recreate every pin.
  useEffect(() => {
    const map = mapRef.current
    const api = apiRef.current
    if (!map || !api) return

    const seen = new Set<number>()
    for (const place of places) {
      if (place.lat == null || place.lng == null) continue
      seen.add(place.id)
      const orderNumbers = dayOrderMap?.[place.id] ?? null
      const selected = selectedPlaceId === place.id
      const photoUrl = placePhotoUrl(place, photoUrls)
      const element = createMarkerElement(place, photoUrl, orderNumbers, selected)

      // Google anchors an AdvancedMarkerElement by the BOTTOM edge of its content
      // (it applies translate(-50%, -100%)), but createMarkerElement draws a pin
      // meant to be anchored at its centre — that is what the GL renderers ask for
      // with anchor: 'center'. Without this offset every pin sits half its own
      // height above the place it marks, and shifts again whenever the pin changes
      // size (selection grows it from 36px to 44px).
      const content = document.createElement('div')
      content.style.transform = 'translateY(50%)'
      content.appendChild(element)

      let marker = markersRef.current.get(place.id)
      if (marker) {
        marker.content = content
        marker.position = { lat: place.lat, lng: place.lng }
      } else {
        marker = new api.marker.AdvancedMarkerElement({
          map,
          content,
          position: { lat: place.lat, lng: place.lng },
        })
        marker.addListener('click', () => handlersRef.current.onMarkerClick?.(place.id))
        markersRef.current.set(place.id, marker)
      }

      element.addEventListener('mouseenter', () => {
        infoRef.current?.setContent(buildPlacePopupHtml(place, null))
        infoRef.current?.open({ map, anchor: marker })
      })
      element.addEventListener('mouseleave', () => infoRef.current?.close())
    }

    for (const [id, marker] of markersRef.current) {
      if (seen.has(id)) continue
      marker.map = null
      markersRef.current.delete(id)
    }
  }, [ready, places, selectedPlaceId, dayOrderMap, photoUrls])

  // Day route.
  useEffect(() => {
    const map = mapRef.current
    const api = apiRef.current
    if (!map || !api) return

    for (const line of linesRef.current) line.setMap(null)
    linesRef.current = []
    if (!route) return

    for (const leg of route) {
      const line = new api.Polyline({
        map,
        path: leg.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: '#4F46E5',
        strokeOpacity: 0.85,
        strokeWeight: 4,
      })
      linesRef.current.push(line)
    }
  }, [ready, route])

  // Re-frame on the same signal the other renderers use.
  useEffect(() => {
    const map = mapRef.current
    const api = apiRef.current
    if (!map || !api || fitKey == null) return

    const points = (dayPlaces?.length ? dayPlaces : places).filter(p => p.lat != null && p.lng != null)
    if (points.length === 0) return

    const bounds = new api.LatLngBounds()
    for (const p of points) bounds.extend({ lat: p.lat as number, lng: p.lng as number })
    map.fitBounds(bounds, 48)
  }, [ready, fitKey, places, dayPlaces])

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-2 p-6 text-center text-content-2">
        {error}
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" />
}

export default MapViewGoogle
