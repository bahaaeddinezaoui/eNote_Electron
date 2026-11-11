# Tutorial videos

One folder per role. The landing page lists all seven roles and plays the video
found in the matching folder — no code change is needed to add one.

```
src/renderer/assets/tutorials/
├── administrator/     ← Admin
├── director/          ← Director
├── secretary/         ← Secretary
├── scheduler/         ← Scheduler
├── teacher/           ← Teacher
├── student/           ← Student
└── developer/         ← Developer
```

## Adding a video

1. Drop the file into the role's folder, e.g.
   `src/renderer/assets/tutorials/administrator/administrator-tour.mp4`
2. Rebuild (`npm run build`, or `npm run dev`, which rebuilds on save).

Supported formats: `.mp4`, `.webm`, `.m4v`, `.mov`, `.ogv`, `.ogg`.
H.264 MP4 plays everywhere Electron does, so it is the safe default.

## Rules the page follows

- **One video per role** fills the card as in the reference layout. If a folder
  holds more than one file, they are shown as a small numbered playlist under
  the role name, in file-name order — so name them `01-…`, `02-…` if you use that.
- A role with an empty folder keeps its place in the section and shows a
  "Recording coming soon" placeholder instead of the player.
- Files are copied into the application bundle, so keep them reasonably light:
  aim for 1080p, 30 fps, and a few minutes. A 3-minute clip is roughly 15–30 MB.
- Nothing is uploaded or streamed: the videos ship with the application, so a
  new recording means a new build.

## Removing the section

Delete the folders' contents (or the folders themselves) and the section shows
placeholders only for roles without a file — it never disappears entirely.
