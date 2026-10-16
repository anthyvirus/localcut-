# LocalCut vs CapCut Desktop: UI comparison

This is a working reference for the LocalCut redesign. It uses only public sources (official CapCut guides, tutorials and shortcut lists). Nothing was downloaded, decompiled or copied from CapCut.

Confidence tags: **[C]** means the point is backed by one of the cited sources below. **[K]** means it is widely seen in public screenshots and tutorials but no fetched source confirmed it. CapCut's labels change between versions.

## 1. CapCut Desktop's public UI patterns (summary)

- **Four dark panes.** The left asset panel, centre player and right inspector sit side by side, with a full-width timeline underneath [C3, K].
- **Top bar.** Menu and logo on the left, an editable project name in the centre, and Shortcuts plus an accent-filled **Export** button on the right [C1, K].
- **Left asset panel.** A row of icon tabs (Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment, Templates/AI media). Each tab has a narrow sub-category list and a grid of thumbnail cards with a "+" button that appears on hover [C1, K].
- **Player.** A "Player" header and a dark letterbox around the canvas. The bottom bar has the timecode (current / total), a centred play button, a Ratio dropdown, fit/zoom and fullscreen. Selected elements get a transform box with guides [C2, C3, K].
- **Inspector.** Context-sensitive, with tabs for Video, Audio, Speed, Animation and Adjustment. Rows are compact slider + number + keyframe-diamond controls, with a Reset link per section. With nothing selected it shows project settings [C3, C4, K].
- **Timeline.** A toolbar (select/split, undo/redo, split, delete left/right, freeze, reverse, mirror, rotate, crop on the left; magnet, snap, linkage, preview axis and zoom on the right). Below it:
  - a timecode ruler and a white playhead with a handle;
  - a taller main track with track headers (lock, hide, mute);
  - colour-coded clips (filmstrip video, teal waveform audio, amber text, purple effects);
  - a white outline and edge trim handles on the selected clip, plus snapping guides [C2, C3, K].
- **Keyboard.** Space, arrows, Ctrl+B split, Q/W delete left/right, Ctrl+Z / Ctrl+Shift+Z, I/O, [ / ], P magnet, N snap, Ctrl+/- zoom, Shift+Z fit, Ctrl+Shift+F fullscreen [C2].
- **Export.** A modal with a cover thumbnail, name and location, resolution, bitrate, codec, format and fps. Then a progress view and a completion screen [C1, C3, K].
- **Look.** Charcoal surfaces (#1a1a1a to #252525), 1px dividers, a cyan/teal accent, 11–12px type, 16px line icons and 4–6px corner radius. Dense layout with draggable splitters [K].
- **AI tools in context.** Auto captions under left Captions; Auto reframe under right Video > Basic; voice enhance and loudness normalisation under right Audio [C1, C3, C5].

## 2. Feature-by-feature comparison

Based on `src/renderer/**` and `tests/.out/shots/*.png`. The current shell is `App.tsx` with a left nav. `views/Workspace.tsx` holds the sources column, the player with the timeline under it, three analysis steps, Suggestions/Clips/Transcript tabs and `ui/Inspector.tsx` on the right.

| Area | CapCut pattern | LocalCut today | Gap | Priority |
|---|---|---|---|---|
| App shell | Top bar: menu, project name, Shortcuts, Export | Persistent left nav (Projects/OBS/Settings), no top bar | No top bar; nav takes width from the editor | P0 |
| Export entry | Accent Export button, top-right | "Export N selected" button in the clip-list tab row | Export is hard to find and depends on the tab | P0 |
| Pane layout | 3 panes over a full-width timeline | Timeline sits only under the player; the sources column runs full height | Timeline is not full width; layout reads as a form | P0 |
| Left panel | Icon tab row, sub-categories, card grid, hover "+" | One text card per source plus an "Add video" button | No tabs or thumbnail grid; suggestions, transcript and clips live elsewhere | P0 |
| Analysis flow | AI tools placed in the left tabs (Captions, AI media) | "1 Audio / 2 Transcript / 3 Suggestions" steps under the timeline | Steps push the timeline down; they belong in left tabs | P1 |
| Player header | "Player" label and menu | None | Missing header | P2 |
| Player bar | Timecode on the left, play in the centre, Ratio, fit and fullscreen on the right | Play on the left, timecode, In/Out, hint text | No Ratio dropdown, fullscreen or centred play | P1 |
| Canvas | Dark letterbox, transform box on selection | Video fills the pane edge to edge | No letterbox or 9:16 framing on the canvas itself | P1 |
| Inspector | Context tabs, slider + number + keyframe rows, Reset | One long scroll: frame preview, crop segment, sliders, switches, headline | No tabs, Reset links or per-row number fields; empty state isn't project settings | P0 |
| Timeline toolbar | Split, delete, undo/redo; magnet, snap, zoom on the right | Legend and zoom slider in the footer | No edit toolbar | P0 |
| Tracks | Main track plus overlay, text and audio tracks; headers with lock, hide, mute | One waveform lane plus silence, candidate and clip bands | No track headers or main-track idea | P1 |
| Clip look | Filmstrip video, teal audio waveform, amber text | Grey waveform, amber clip bar | No filmstrip; clip colours don't follow a convention | P1 |
| Selection | White outline and thick edge trim handles; drag to trim | Selection range shown as a highlight | No clip outline or trim handles | P0 |
| Playhead | White line with a top handle | Thin white line, no handle | Handle missing | P2 |
| Ruler | Fine timecode ticks | Ticks every 5s | Basic but acceptable | P2 |
| Shortcuts | Full set in [C2] | Space, I/O, arrow nudge, Home/End | Missing Ctrl+B, Q/W, undo/redo, zoom, fullscreen and [ / ] | P1 |
| Undo/redo | Ctrl+Z / Ctrl+Shift+Z | Not present | Needs a history stack for clip edits | P1 |
| Export modal | Cover, name, location, resolution, fps; then progress and completion | Starts jobs directly; progress shows in JobTray | No settings modal or completion view | P1 |
| Status/jobs | Progress modal | Bottom JobTray strip | Fine; keep it and add the modal | P2 |
| Palette | Charcoal panels, cyan/teal accent | Graphite plus a teal accent token, but amber primary buttons are still in use (styles.css comment, shots) | Two accents compete; pick teal only | P0 |
| Density/type | 11–12px type, 16px icons, compact rows | About 13px type, roomy padding, large section labels | Too airy for an editor | P1 |
| Splitters | Draggable pane splitters | Fixed grid | No resizing | P2 |
| Auto reframe | Video > Basic | Blurred copy / Crop to fill / Black segment at the top of the inspector | Already present; move it into a Video tab | P1 |
| Captions | Captions tab and caption track | Transcript tab; headline field in the inspector | No caption track on the timeline | P2 |

## 3. Top 10 gaps to close

1. **Editor shell.** Add a top bar (back to Projects, editable project name, Shortcuts, accent **Export** on the right). Fold the persistent left nav into it while a project is open.
2. **Four-pane grid.** Left asset panel, centre player and right inspector over a **full-width timeline**, with draggable splitters if time allows.
3. **Left asset panel with icon tabs.** Media (source cards with thumbnails and hover "+"), AI (audio analysis, transcribe, find moments), Suggestions (card grid), Captions/Transcript and Clips.
4. **Context inspector with tabs.** For a clip: Video (frame/reframe, size, position), Background (blur, darkness, zoom), Text (headline, font, colour, size) and Audio (remove silences). Rows are slider + number field, with a Reset link per section. With nothing selected, show project and source info.
5. **Timeline toolbar.** Left side: undo, redo, split at playhead, delete, mark in/out. Right side: snap toggle, zoom-out, zoom slider, zoom-in, fit.
6. **Timeline tracks.** Track headers with icons; a main video track with a thumbnail filmstrip; an audio track with a teal waveform; a clip/suggestion band. Use consistent colour codes.
7. **Selection and trimming.** White outline and thick edge handles on the selected clip, with edge-drag trimming that snaps to the playhead and silence edges.
8. **Player bar.** Timecode on the left, centred transport, Ratio (9:16 / 16:9 / 1:1) and fullscreen on the right. Letterbox the canvas on a darker background.
9. **One accent and denser type.** Teal only for primary actions, active tabs, toggles and slider fills. 12px UI and 11px labels, 16px line icons, 4–6px corner radius, 1px dividers.
10. **Shortcuts plus an Export modal.** Ctrl+B, Delete, Q/W, Ctrl+Z / Ctrl+Shift+Z, Ctrl+= / Ctrl+-, Shift+Z, [ / ], Ctrl+Shift+F, and a shortcuts sheet. The Export modal gets a cover, output folder, resolution and fps, then progress and completion, while still using the existing FFmpeg export jobs.

Every change has to keep these working: FFmpeg export, AI suggestions, project saving, the OBS view and the existing tests. The existing data flow (`api().…`, project events) stays as it is. Only the presentation layer changes.

### Progress (2026-10-16)
- Done: 1, 3, 4, 5, 6, 9.
- Mostly done: 2 (no draggable splitters yet), 7 (trim handles and snapping work; snapping to silence edges is not built), 8 (ratio is changed in the Video tab, not on the player bar).
- Partly done: 10. Ctrl+B, Delete, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Space, I/O and arrows work. Q/W, zoom shortcuts, the shortcuts sheet and a separate Export dialog are not built; export runs from the top-bar button and the Jobs drawer.

## 4. Originality and trade dress

LocalCut copies CapCut's **layout and interaction patterns**: the general four-pane editor convention, toolbar placement, selection affordances and shortcut ergonomics shared by most NLEs. It does so with its **own icons** (`ui/icons.tsx`, original line SVGs), its **own colours and tokens** (`ui/styles.css`), its **own wording** and its own name and branding. No CapCut logos, icon artwork, screenshots, fonts, sounds, templates, proprietary code or distinctive trade dress are used. Inter is bundled under the SIL Open Font License. Where CapCut's labels are generic editing terms ("Export", "Split", "Ratio"), LocalCut uses the same plain words because they are standard vocabulary.

## Sources

- [C1] https://www.capcut.com/resource/how-to-use-capcut-on-pc (official)
- [C2] https://fastshortcuts.com/shortcuts/capcut/
- [C3] https://primalvideo.com/guides/capcut-for-pc-mac-tutorial/
- [C4] https://www.capcut.com/resource/how-to-do-velocity-on-capcut ; https://capcut.com/resource/how-to-use-capcut (official)
- [C5] https://www.capcut.com/tools/desktop-ai-power ; https://www.capcut.com/resource/pc-professional-video-editor (official)
- [C6] https://www.capcut.com/resource/how-to-use-capcut
- Also referenced: https://www.skillademia.com/shortcuts/capcut-shortcuts/ ; https://www.elephorm.com/formation/maitriser-capcut-2026-les-fondamentaux/presentation-de-linterface-sur-capcut-pour-le-montage-video
