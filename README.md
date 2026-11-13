# Soy Cuba

An iPhone camera that shoots in four black-and-white film looks, with a live filtered viewfinder.

- **SOY CUBA** (crisp, infrared) — *I Am Cuba*'s exteriors: skies go near-black, cane, palms
  and foliage glow white, skin is luminous. Sharp and deep-focus, printed grey with lifted
  blacks, capped highlights and heavy grain. Try the 0.5 lens, low and close.
- **HABANA** (crisp, night) — the film's interiors and night streets: ordinary black-and-white
  stock, hard light, every pore in focus, grainy shadows.
- **NOCTURNE** (soft, gothic) — a blue-sensitive response that turns lips and veins dark
  against white skin, blacks crushed to nothing, gentle diffusion and glow, edges falling out of focus.
- **ESPECTRO** (gothic, textured) — the same response and crushed blacks, but skin, hair and
  fabric keep their texture, with less glow and more grain.

The gothic looks work best with a dark background and one light on the face.

There are two versions with the same looks:

- **Web app** (`docs/`) — runs in Safari on the iPhone, no Mac or Apple developer account needed.
- **Native app** (`SoyCuba/`, `SoyCuba.xcodeproj`) — full-resolution photos; needs Xcode to build.

## Web app

Hosting it with GitHub Pages (once):

1. On GitHub, open the repository's **Settings → Pages**.
2. Under *Build and deployment*, set **Source** to *Deploy from a branch*, pick the branch that
   holds this code and the **/docs** folder, and save.
3. After a minute the page shows the site address (`https://<owner>.github.io/<repository>/`).

On the iPhone, open that address in Safari and allow the camera. To make it feel like an app,
tap Share → **Add to Home Screen**.

After taking a photo, tap **Save** and choose *Save Image*, or press and hold the photo.

Limits compared with the native app: photos are taken from the live video feed (about
1920 × 1440), exposure is a digital adjustment rather than a camera setting, there is no
tap-to-focus, and lens buttons appear only if Safari lists the rear lenses separately.

## Using the native app

- Pick a look under the viewfinder; tap the viewfinder to focus and meter.
- Lens buttons switch between the rear cameras; the right-hand button flips to the front camera.
- `4:3` / `16:9` sets the frame. Turn the phone sideways for a landscape picture.
- The sliders button opens Exposure, Grain and Glow (double-tap a label to reset it).
- The photo button develops an existing picture from your library with the current look.
- Photos are saved to the Photos library as full-resolution JPEGs.

## Building the native app

Requires Xcode 16 or later and an iPhone on iOS 17 or later.

1. Open `SoyCuba.xcodeproj`.
2. In the SoyCuba target's *Signing & Capabilities*, choose your team and change the bundle
   identifier from `com.example.SoyCuba` to one of your own.
3. Run on a phone. The Simulator has no camera, but importing a photo works there.

## How the looks work

`FilmLook.swift` describes each look as numbers; `FilmProcessor.swift` applies them with Core Image:

1. A 3D lookup table converts colour to grey using the film's spectral response (negative blue
   and boosted greens for infrared; almost no red for ortho) followed by its tone curve.
2. Sharpening or diffusion, highlight glow, edge blur and vignette.
3. Grain, weighted toward the midtones, sized relative to the frame so the preview matches the photo.

To retune a look, edit its values in `FilmLook.swift`.
