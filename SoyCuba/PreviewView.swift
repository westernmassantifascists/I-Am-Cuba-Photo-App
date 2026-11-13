import SwiftUI
import MetalKit
import CoreImage

/// Holds the newest camera frame and draws it, filtered, into a Metal view.
final class FrameRenderer: NSObject, MTKViewDelegate, @unchecked Sendable {
    let processor: FilmProcessor
    private let lock = NSLock()
    private var frame: CIImage?
    private var storedParams = RenderParams()

    init(processor: FilmProcessor) {
        self.processor = processor
    }

    var params: RenderParams {
        get { lock.lock(); defer { lock.unlock() }; return storedParams }
        set { lock.lock(); storedParams = newValue; lock.unlock() }
    }

    func update(frame: CIImage?) {
        lock.lock(); self.frame = frame; lock.unlock()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        lock.lock()
        let source = frame
        let params = storedParams
        lock.unlock()
        guard let source,
              let drawable = view.currentDrawable,
              let commandBuffer = processor.commandQueue?.makeCommandBuffer() else { return }

        var image = processor.process(source, params: params)
        let size = view.drawableSize
        let bounds = CGRect(origin: .zero, size: size)
        let scale = min(size.width / image.extent.width, size.height / image.extent.height)
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        image = image.transformed(by: CGAffineTransform(
            translationX: ((size.width - image.extent.width) / 2).rounded(),
            y: ((size.height - image.extent.height) / 2).rounded()))
        image = image.composited(over: CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: bounds))

        let destination = CIRenderDestination(
            width: Int(size.width), height: Int(size.height),
            pixelFormat: view.colorPixelFormat, commandBuffer: commandBuffer,
            mtlTextureProvider: { drawable.texture })
        _ = try? processor.context.startTask(toRender: image, from: bounds, to: destination, at: .zero)
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}

struct PreviewView: UIViewRepresentable {
    let renderer: FrameRenderer

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: renderer.processor.device)
        view.framebufferOnly = false
        view.colorPixelFormat = .bgra8Unorm
        view.preferredFramesPerSecond = 30
        view.backgroundColor = .black
        view.delegate = renderer
        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {}
}
