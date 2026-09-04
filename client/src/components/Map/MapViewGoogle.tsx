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
  // What each marker was last drawn from. Assigning marker.content makes Google
  // re-measure and re-place that marker, so rebuilding all of them on every pass
  // is both wasted work and a visible twitch — and this effect runs again on
  // every thumbnail arrival, which for a 34-place trip is a lot of passes.
  const markerSigRef = useRef<Map<number, string>>(new Map())
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
        framedOnMountRef.current = framed !== null
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
          // Ask for vector explicitly. Without this the map initialises as
          // RASTER, and on a raster map Google moves AdvancedMarkerElement pins
          // with a coarse transform during a drag and then re-projects them
          // precisely on idle — the pins visibly jump a second after every pan
          // while the basemap sits still. Vector also gives the map a heading,
          // without which the compass pill has nothing to rotate.
          renderingType: api.RenderingType.VECTOR,
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

      // Everything createMarkerElement draws from. Unchanged signature → the pin
      // on screen is already correct, so leave it alone.
      const signature = [
        place.lat, place.lng, photoUrl ?? '', selected,
        orderNumbers?.join('.') ?? '', place.category_id ?? '', place.image_url ?? '',
      ].join('|')

      const existing = markersRef.current.get(place.id)
      if (existing && markerSigRef.current.get(place.id) === signature) continue
      markerSigRef.current.set(place.id, signature)

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

      let marker = existing
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
        // shouldFocus:false is load-bearing, not tidiness. Left unset, Google's
        // heuristic moves focus into the info window when focus is already inside
        // the map (which it is once the user has clicked a pin), and on close it
        // returns focus to the marker. That programmatic focus() runs
        // scroll-into-view on every overflow:hidden ancestor, shifting the marker
        // pane and snapping it back — a pin visibly jumping away and returning on
        // mouse-out. A hover card should never take focus anyway; the GL
        // renderer's card is not focusable either.
        infoRef.current?.open({ map, anchor: marker, shouldFocus: false })
      })
      element.addEventListener('mouseleave', () => infoRef.current?.close())
    }

    for (const [id, marker] of markersRef.current) {
      if (seen.has(id)) continue
      marker.map = null
      markersRef.current.delete(id)
      markerSigRef.current.delete(id)
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

  // Re-frame on the same signal the other renderers use: a CHANGE of fitKey, and
  // nothing else. Both MapView and MapViewGL gate on prevFitKey for a reason —
  // panning the map makes the planner re-render, which hands this component new
  // `places`/`dayPlaces` array identities. With those in the dependency list the
  // camera refitted itself a beat after every pan, throwing the user back to the
  // trip-wide view they had just navigated away from.
  const prevFitKey = useRef<number | null | undefined>(-1)
  const framedOnMountRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const api = apiRef.current
    if (!map || !api || fitKey == null) return
    if (fitKey === prevFitKey.current) return
    prevFitKey.current = fitKey

    // Construction already framed the map to these places, so stand down for the
    // first fitKey; every later one (picking a day) still runs. Same rule as
    // MapViewGL's framedOnMount.
    if (framedOnMountRef.current) {
      framedOnMountRef.current = false
      return
    }

    const points = (dayPlaces?.length ? dayPlaces : places).filter(p => p.lat != null && p.lng != null)
    if (points.length === 0) return

    const bounds = new api.LatLngBounds()
    for (const p of points) bounds.extend({ lat: p.lat as number, lng: p.lng as number })
    map.fitBounds(bounds, 48)
    // places/dayPlaces are read, not depended on: a new array identity from a
    // parent re-render must not re-frame the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey])

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
