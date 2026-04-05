import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default marker icons broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

import { registerTool, initBridge, sendStateUpdate } from './bridge'

interface InfoState {
  markerCount: number
  center: { lat: number; lng: number }
  zoom: number
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const highlightsRef = useRef<Map<string, L.GeoJSON>>(new Map())
  const [info, setInfo] = useState<InfoState>({
    markerCount: 0,
    center: { lat: 20, lng: 0 },
    zoom: 2,
  })

  const updateInfo = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    const newInfo: InfoState = {
      markerCount: markersRef.current.size,
      center: { lat: Math.round(center.lat * 1000) / 1000, lng: Math.round(center.lng * 1000) / 1000 },
      zoom: map.getZoom(),
    }
    setInfo(newInfo)
  }, [])

  const broadcastState = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    sendStateUpdate({
      markerCount: markersRef.current.size,
      highlightCount: highlightsRef.current.size,
      center: { lat: center.lat, lng: center.lng },
      zoom: map.getZoom(),
      markerIds: Array.from(markersRef.current.keys()),
      highlightIds: Array.from(highlightsRef.current.keys()),
    })
  }, [])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true,
    })

    // Use CartoDB tiles — OSM tiles require a Referer header which sandboxed
    // iframes (without allow-same-origin) cannot provide, resulting in 403.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map)

    mapRef.current = map

    map.on('moveend zoomend', () => {
      updateInfo()
    })

    // Register tool handlers
    registerTool('fly_to', async (params) => {
      const { lat, lng, zoom, name } = params as { lat: number; lng: number; zoom?: number; name?: string }
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new Error('lat and lng are required numbers')
      }
      const targetZoom = typeof zoom === 'number' ? zoom : 10
      map.flyTo([lat, lng], targetZoom)

      if (name) {
        const popup = L.popup()
          .setLatLng([lat, lng])
          .setContent(`<strong>${name}</strong>`)
          .openOn(map)
        setTimeout(() => map.closePopup(popup), 5000)
      }

      updateInfo()
      broadcastState()
      return { success: true, center: { lat, lng }, zoom: targetZoom }
    })

    registerTool('add_marker', async (params) => {
      const { id, lat, lng, label, description } = params as {
        id: string; lat: number; lng: number; label: string; description?: string
      }
      if (!id || typeof lat !== 'number' || typeof lng !== 'number' || !label) {
        throw new Error('id, lat, lng, and label are required')
      }

      // Remove existing marker with same id
      if (markersRef.current.has(id)) {
        markersRef.current.get(id)!.remove()
      }

      const popupContent = description
        ? `<strong>${label}</strong><br/>${description}`
        : `<strong>${label}</strong>`

      const marker = L.marker([lat, lng])
        .bindPopup(popupContent)
        .addTo(map)

      markersRef.current.set(id, marker)
      updateInfo()
      broadcastState()
      return { success: true, markerId: id }
    })

    registerTool('remove_marker', async (params) => {
      const { id } = params as { id: string }
      if (!id) throw new Error('id is required')

      const marker = markersRef.current.get(id)
      if (!marker) throw new Error(`Marker not found: ${id}`)

      marker.remove()
      markersRef.current.delete(id)
      updateInfo()
      broadcastState()
      return { success: true }
    })

    registerTool('highlight_region', async (params) => {
      const { id, geojson, color } = params as { id: string; geojson: object; color?: string }
      if (!id || !geojson) throw new Error('id and geojson are required')

      // Remove existing highlight with same id
      if (highlightsRef.current.has(id)) {
        highlightsRef.current.get(id)!.remove()
      }

      const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject, {
        style: {
          color: color || '#3388ff',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.25,
        },
      }).addTo(map)

      highlightsRef.current.set(id, layer)
      broadcastState()
      return { success: true }
    })

    registerTool('clear_map', async () => {
      const markerCount = markersRef.current.size
      const highlightCount = highlightsRef.current.size

      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()

      highlightsRef.current.forEach((h) => h.remove())
      highlightsRef.current.clear()

      updateInfo()
      broadcastState()
      return { success: true, cleared: { markers: markerCount, highlights: highlightCount } }
    })

    initBridge()

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [updateInfo, broadcastState])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div
        ref={mapContainerRef}
        id="map-container"
        style={{ width: '100%', height: '100%' }}
      />
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(8px)',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.6,
          color: '#333',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          minWidth: 160,
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
          World Map
        </div>
        <div>Markers: {info.markerCount}</div>
        <div>
          Center: {info.center.lat}, {info.center.lng}
        </div>
        <div>Zoom: {info.zoom}</div>
      </div>
    </div>
  )
}
