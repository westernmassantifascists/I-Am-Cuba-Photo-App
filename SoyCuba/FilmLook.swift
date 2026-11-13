import Foundation

/// A black-and-white film emulation, described as plain numbers.
///
/// The colour → tone part (`tone(r:g:b:)`) is baked into a 3D lookup table;
/// the remaining fields drive the spatial effects (glow, grain, vignette, blur).
struct FilmLook: Identifiable, Equatable {
    let id: String
    let name: String
    let detail: String

    // Spectral response: how much each (linear) channel contributes to exposure.
    var red: Float
    var green: Float
    var blue: Float
    /// Extra exposure for warm/green subjects (g − b): the infrared "Wood effect" and luminous skin.
    var foliage: Float
    /// Extra exposure for pure greens (g − r).
    var greenLift: Float

    // Tone curve (applied in a gamma 2.2 domain).
    var gain: Float
    var blackPoint: Float
    var whitePoint: Float
    var contrast: Float
    /// Darkest and brightest values the "print" can reach.
    var lift: Float
    var ceiling: Float

    // Spatial character. Sizes are fractions of the image's short side.
    var bloom: Float
    var grain: Float
    /// 0 = grain only in midtones, 1 = grain everywhere including blacks.
    var grainFloor: Float
    var vignette: Float
    var softness: Float
    var edgeBlur: Float

    /// Maps an sRGB-encoded colour to an encoded grey value.
    func tone(r: Float, g: Float, b: Float) -> Float {
        func linear(_ v: Float) -> Float {
            v <= 0.04045 ? v / 12.92 : powf((v + 0.055) / 1.055, 2.4)
        }
        let lr = linear(r), lg = linear(g), lb = linear(b)
        let exposure = red * lr + green * lg + blue * lb
            + foliage * max(0, lg - lb)
            + greenLift * max(0, lg - lr)
        var x = powf(min(max(exposure * gain, 0), 1), 1 / 2.2)
        x = min(max((x - blackPoint) / (whitePoint - blackPoint), 0), 1)
        let a = powf(x, contrast), c = powf(1 - x, contrast)
        let y = a / (a + c + 1e-9)
        return lift + (ceiling - lift) * y
    }

    /// I Am Cuba (1964): infrared negative — black skies, glowing cane and palms,
    /// luminous skin — printed soft and grey with lifted blacks and heavy grain.
    static let soyCuba = FilmLook(
        id: "soycuba", name: "SOY CUBA", detail: "Infrared · 1964",
        red: 0.80, green: 0.60, blue: -0.40, foliage: 1.2, greenLift: 1.5,
        gain: 1.0, blackPoint: 0.02, whitePoint: 1.05, contrast: 1.25,
        lift: 0.045, ceiling: 0.77,
        bloom: 0.35, grain: 0.045, grainFloor: 0.45,
        vignette: 0.30, softness: 0.0012, edgeBlur: 0)

    /// The portrait references: blue-sensitive (orthochromatic) response that turns
    /// lips and veins dark against white skin, crushed blacks, glow, soft dark edges.
    static let nocturne = FilmLook(
        id: "nocturne", name: "NOCTURNE", detail: "Ortho · crushed black",
        red: 0.10, green: 0.55, blue: 0.35, foliage: 0, greenLift: 0,
        gain: 1.35, blackPoint: 0.24, whitePoint: 0.97, contrast: 1.8,
        lift: 0, ceiling: 0.985,
        bloom: 0.35, grain: 0.016, grainFloor: 0,
        vignette: 0.85, softness: 0.002, edgeBlur: 0.012)

    static let all: [FilmLook] = [.soyCuba, .nocturne]
}

enum FrameFormat: String, CaseIterable, Identifiable {
    case academy = "4:3"
    case wide = "16:9"
    var id: String { rawValue }
    /// Long side divided by short side.
    var ratio: CGFloat { self == .academy ? 4.0 / 3.0 : 16.0 / 9.0 }
}

/// Everything the processor needs to render one frame.
struct RenderParams {
    var look: FilmLook = .soyCuba
    /// User multipliers on the look's own grain and glow (1 = as designed).
    var grainAmount: Float = 1
    var glowAmount: Float = 1
    var format: FrameFormat = .academy
}
