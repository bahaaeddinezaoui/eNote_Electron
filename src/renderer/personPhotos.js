import { useEffect, useRef, useState } from 'react'

// Person photos are stored as file paths, so every list that shows a face has
// to read them through the main process. This hook asks for the photos of the
// rows currently on screen in ONE IPC call, caches the result by person id and
// leaves a row whose photo is missing (or whose file is gone) to fall back to
// its initials. Call it unconditionally, before any early return.
export function usePersonPhotos(rows) {
  const [photos, setPhotos] = useState({})
  const inFlight = useRef(new Set())

  useEffect(() => {
    const wanted = []
    for (const row of rows || []) {
      if (!row) continue
      const id = Number(row.PERSON_ID ?? row.person_id)
      const photoPath = row.PERSON_PHOTO || row.person_photo || null
      if (!id || !photoPath) continue
      if (Object.prototype.hasOwnProperty.call(photos, id) || inFlight.current.has(id)) continue
      wanted.push({ id, path: photoPath })
    }
    if (wanted.length === 0) return

    for (const entry of wanted) inFlight.current.add(entry.id)
    window.api.readPersonPhotos(wanted.map((entry) => entry.path))
      .then((res) => {
        const dataUrls = res?.dataUrls || []
        setPhotos((prev) => {
          const next = { ...prev }
          wanted.forEach((entry, index) => { next[entry.id] = dataUrls[index] || null })
          return next
        })
      })
      // A picture that cannot be read is not an error: the row keeps its initials.
      .catch(() => {})
      .finally(() => { for (const entry of wanted) inFlight.current.delete(entry.id) })
  }, [rows, photos])

  return photos
}

// Two-letter monogram shown while there is no picture to display.
export const initialsOf = (firstName, lastName) =>
  `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()

// Same monogram when only a display name is available ("BELKACEM Amine").
export const initialsOfName = (name) =>
  String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()