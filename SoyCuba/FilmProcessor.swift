import CoreImage
import CoreImage.CIFilterBuiltins
import Metal

/// Turns a colour camera image into a finished black-and-white frame.
/// The same pipeline renders the live preview and the full-resolution photo.
final class FilmProcessor: @unchecked Sendable {
    let device: MTLDevice?
    let commandQueue: MTLCommandQueue?
    let context: CIContext

    private let cubeSize = 32
    private var cubes: [String: Data] = [:]
    private let lock = NSLock()

    init() {
        // No colour management: all maths happens on encoded (gamma) values,
        // which is what the looks were tuned against.
        let options: [CIContextOption: Any] = [.workingColorSpace: NSNull(), .cacheIntermediates: false]
        device = MTLCreateSystemDefaultDevice()
        commandQueue = device?.makeCommandQueue()
        if let commandQueue {
            context = CIContext(mtlCommandQueue: commandQueue, options: options)
        } else {
            context = CIContext(options: options)
        }
    }

    func process(_ source: CIImage, params: RenderParams) -> CIImage {
        let look = params.look
        var image = crop(source, to: params.format)
        image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
        let extent = image.extent
        let short = min(extent.width, extent.height)
        let center = CGPoint(x: extent.midX, y: extent.midY)
        let halfDiagonal = hypot(extent.width, extent.height) / 2

        // 1. Spectral response + tone curve.
        let cube = CIFilter.colorCube()
        cube.inputImage = image
        cube.cubeDimension = Float(cubeSize)
        cube.cubeData = cubeData(for: look)
        image = cube.outputImage ?? image

        // 2. Lens softness.
        if look.softness > 0 {
            image = image.clampedToExtent()
                .applyingGaussianBlur(sigma: Double(short) * Double(look.softness))
                .cropped(to: extent)
        }

        // 3. Highlight glow / halation.
        let glow = look.bloom * params.glowAmount
        if glow > 0 {
            let bloom = CIFilter.bloom()
            bloom.inputImage = image.clampedToExtent()
            bloom.radius = Float(short) * 0.03
            bloom.intensity = glow
            image = (bloom.outputImage ?? image).cropped(to: extent)
        }

        // 4. Focus falling away toward the edges.
        if look.edgeBlur > 0 {
            let mask = CIFilter.radialGradient()
            mask.center = center
            mask.radius0 = Float(short) * 0.28
            mask.radius1 = Float(halfDiagonal)
            mask.color0 = CIColor(red: 0, green: 0, blue: 0)
            mask.color1 = CIColor(red: 1, green: 1, blue: 1)
            let blur = CIFilter.maskedVariableBlur()
            blur.inputImage = image.clampedToExtent()
            blur.mask = mask.outputImage?.cropped(to: extent)
            blur.radius = Float(short) * look.edgeBlur
            image = (blur.outputImage ?? image).cropped(to: extent)
        }

        // 5. Vignette.
        if look.vignette > 0 {
            let edge = CGFloat(1 - look.vignette)
            let falloff = CIFilter.radialGradient()
            falloff.center = center
            falloff.radius0 = Float(halfDiagonal) * 0.35
            falloff.radius1 = Float(halfDiagonal)
            falloff.color0 = CIColor(red: 1, green: 1, blue: 1)
            falloff.color1 = CIColor(red: edge, green: edge, blue: edge)
            let multiply = CIFilter.multiplyCompositing()
            multiply.inputImage = falloff.outputImage?.cropped(to: extent)
            multiply.backgroundImage = image
            image = multiply.outputImage ?? image
        }

        // 6. Grain.
        let grain = look.grain * params.grainAmount
        if grain > 0 {
            image = addGrain(to: image, amount: grain, floor: look.grainFloor, shortSide: short)
        }
        return image.cropped(to: extent)
    }

    /// Adds signed, tone-weighted noise: `out = x ± amplitude · w(x)`, with the sign and size
    /// taken from a noise mask. Built from a lighter and a darker copy so no negative
    /// intermediate values are needed.
    private func addGrain(to image: CIImage, amount: Float, floor: Float, shortSide: CGFloat) -> CIImage {
        guard let noise = CIFilter.randomGenerator().outputImage else { return image }
        let extent = image.extent
        let cell = max(1, shortSide / 700)
        let offset = CGPoint(x: -CGFloat.random(in: 0...2000), y: -CGFloat.random(in: 0...2000))
        let mask = noise
            .transformed(by: CGAffineTransform(scaleX: cell, y: cell))
            .transformed(by: CGAffineTransform(translationX: offset.x, y: offset.y))
            .applyingGaussianBlur(sigma: Double(cell) * 0.35)
            .cropped(to: extent)

        // w(x) = floor + (1 − floor) · 4x(1 − x): strongest in the midtones.
        let a = CGFloat(amount) * 1.6
        let f = CGFloat(floor)
        let k = 4 * a * (1 - f)
        func shifted(_ sign: CGFloat) -> CIImage {
            let coefficients = CIVector(x: sign * a * f, y: 1 + sign * k, z: -sign * k, w: 0)
            let poly = CIFilter.colorPolynomial()
            poly.inputImage = image
            poly.redCoefficients = coefficients
            poly.greenCoefficients = coefficients
            poly.blueCoefficients = coefficients
            poly.alphaCoefficients = CIVector(x: 0, y: 1, z: 0, w: 0)
            return poly.outputImage ?? image
        }
        let blend = CIFilter.blendWithRedMask()
        blend.inputImage = shifted(1)
        blend.backgroundImage = shifted(-1)
        blend.maskImage = mask
        return blend.outputImage ?? image
    }

    /// Centre-crops to the format, in whichever orientation the image already has.
    private func crop(_ image: CIImage, to format: FrameFormat) -> CIImage {
        let e = image.extent
        let landscape = e.width >= e.height
        let long = landscape ? e.width : e.height
        let short = landscape ? e.height : e.width
        var newLong = long, newShort = short
        if long / short > format.ratio {
            newLong = (short * format.ratio).rounded(.down)
        } else {
            newShort = (long / format.ratio).rounded(.down)
        }
        let size = landscape ? CGSize(width: newLong, height: newShort) : CGSize(width: newShort, height: newLong)
        let rect = CGRect(x: (e.midX - size.width / 2).rounded(), y: (e.midY - size.height / 2).rounded(),
                          width: size.width, height: size.height)
        return image.cropped(to: rect)
    }

    private func cubeData(for look: FilmLook) -> Data {
        lock.lock(); defer { lock.unlock() }
        if let cached = cubes[look.id] { return cached }
        let n = cubeSize
        var values = [Float](repeating: 1, count: n * n * n * 4)
        var i = 0
        for b in 0..<n {
            for g in 0..<n {
                for r in 0..<n {
                    let v = look.tone(r: Float(r) / Float(n - 1), g: Float(g) / Float(n - 1), b: Float(b) / Float(n - 1))
                    values[i] = v; values[i + 1] = v; values[i + 2] = v; values[i + 3] = 1
                    i += 4
                }
            }
        }
        let data = values.withUnsafeBufferPointer { Data(buffer: $0) }
        cubes[look.id] = data
        return data
    }
}
