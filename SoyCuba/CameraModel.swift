import AVFoundation
import CoreImage
import Photos
import SwiftUI

struct Lens: Identifiable, Equatable {
    let id: String
    let label: String
    let device: AVCaptureDevice
}

final class CameraModel: NSObject, ObservableObject, @unchecked Sendable {
    enum Status: Equatable { case starting, running, denied, unavailable }

    @Published var status: Status = .starting
    @Published var look: FilmLook = .soyCuba { didSet { pushParams() } }
    @Published var grain: Float = 1 { didSet { pushParams() } }
    @Published var glow: Float = 1 { didSet { pushParams() } }
    @Published var format: FrameFormat = .academy { didSet { pushParams() } }
    @Published var exposureBias: Float = 0 { didSet { applyExposureBias() } }
    @Published var lenses: [Lens] = []
    @Published var lensID: String?
    @Published var isFront = false
    @Published var isBusy = false
    @Published var message: String?
    @Published var lastPhoto: UIImage?

    let processor = FilmProcessor()
    let renderer: FrameRenderer

    private let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let sessionQueue = DispatchQueue(label: "soycuba.session")
    private let videoQueue = DispatchQueue(label: "soycuba.video")
    private let workQueue = DispatchQueue(label: "soycuba.develop", qos: .userInitiated)
    private var input: AVCaptureDeviceInput?
    private var rotation: AVCaptureDevice.RotationCoordinator?
    private var configured = false

    override init() {
        renderer = FrameRenderer(processor: processor)
        super.init()
        pushParams()
    }

    private func pushParams() {
        renderer.params = RenderParams(look: look, grainAmount: grain, glowAmount: glow, format: format)
    }

    // MARK: Session

    func start() {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else {
                DispatchQueue.main.async { self.status = .denied }
                return
            }
            self.sessionQueue.async {
                if !self.configured { self.configure() }
                if self.configured && !self.session.isRunning { self.session.startRunning() }
            }
        }
    }

    func stop() {
        sessionQueue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    private func discover(front: Bool) -> [Lens] {
        let types: [AVCaptureDevice.DeviceType] = front
            ? [.builtInWideAngleCamera]
            : [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera]
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .video, position: front ? .front : .back).devices
        return types.compactMap { type in
            guard let device = devices.first(where: { $0.deviceType == type }) else { return nil }
            let label: String
            switch type {
            case .builtInUltraWideCamera: label = "0.5"
            case .builtInTelephotoCamera: label = "TELE"
            default: label = "1×"
            }
            return Lens(id: device.uniqueID, label: label, device: device)
        }
    }

    private func configure() {
        let found = discover(front: false)
        guard let first = found.first(where: { $0.device.deviceType == .builtInWideAngleCamera }) ?? found.first else {
            DispatchQueue.main.async { self.status = .unavailable }
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .photo
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        photoOutput.maxPhotoQualityPrioritization = .quality
        attach(first.device)
        session.commitConfiguration()
        configured = true
        DispatchQueue.main.async {
            self.lenses = found
            self.lensID = first.id
            self.isFront = false
            self.status = .running
        }
    }

    /// Swaps the camera input. Call on `sessionQueue`, inside a configuration block.
    private func attach(_ device: AVCaptureDevice) {
        guard let newInput = try? AVCaptureDeviceInput(device: device) else { return }
        let old = input
        if let old { session.removeInput(old) }
        if session.canAddInput(newInput) {
            session.addInput(newInput)
            input = newInput
        } else if let old, session.canAddInput(old) {
            session.addInput(old)
            return
        }
        rotation = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
        let front = device.position == .front
        if let connection = videoOutput.connection(with: .video) {
            // The interface is portrait-only, so preview frames are always upright portrait.
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = front
            }
        }
        if let connection = photoOutput.connection(with: .video), connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = front
        }
        let bias = exposureBias
        setBias(bias, on: device)
    }

    func select(_ lens: Lens) {
        lensID = lens.id
        sessionQueue.async {
            self.session.beginConfiguration()
            self.attach(lens.device)
            self.session.commitConfiguration()
        }
    }

    func flip() {
        let front = !isFront
        sessionQueue.async {
            let found = self.discover(front: front)
            guard let lens = found.first(where: { $0.device.deviceType == .builtInWideAngleCamera }) ?? found.first else { return }
            self.session.beginConfiguration()
            self.attach(lens.device)
            self.session.commitConfiguration()
            DispatchQueue.main.async {
                self.lenses = found
                self.lensID = lens.id
                self.isFront = front
            }
        }
    }

    // MARK: Exposure and focus

    private func applyExposureBias() {
        let bias = exposureBias
        sessionQueue.async {
            guard let device = self.input?.device else { return }
            self.setBias(bias, on: device)
        }
    }

    private func setBias(_ bias: Float, on device: AVCaptureDevice) {
        guard (try? device.lockForConfiguration()) != nil else { return }
        device.setExposureTargetBias(min(max(bias, device.minExposureTargetBias), device.maxExposureTargetBias))
        device.unlockForConfiguration()
    }

    /// `point` is normalised to the visible preview, origin top-left.
    func focus(at point: CGPoint) {
        // Undo the centred format crop (the preview is portrait, so 16:9 trims the width).
        let widthKept = (4.0 / 3.0) / format.ratio
        let x = 0.5 + (point.x - 0.5) * widthKept
        // Portrait preview → the sensor's native landscape coordinates.
        let sensorPoint = CGPoint(x: point.y, y: isFront ? x : 1 - x)
        sessionQueue.async {
            guard let device = self.input?.device, (try? device.lockForConfiguration()) != nil else { return }
            if device.isFocusPointOfInterestSupported, device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusPointOfInterest = sensorPoint
                device.focusMode = .continuousAutoFocus
            }
            if device.isExposurePointOfInterestSupported, device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposurePointOfInterest = sensorPoint
                device.exposureMode = .continuousAutoExposure
            }
            device.unlockForConfiguration()
        }
    }

    // MARK: Capture and import

    func capture() {
        guard status == .running, !isBusy else { return }
        isBusy = true
        sessionQueue.async {
            if let connection = self.photoOutput.connection(with: .video), let rotation = self.rotation {
                // Turning the phone sideways gives a landscape frame.
                let angle = rotation.videoRotationAngleForHorizonLevelCapture
                if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
            }
            let settings = AVCapturePhotoSettings()
            settings.photoQualityPrioritization = .quality
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    /// Applies the current look to an existing photo.
    func develop(imported data: Data) {
        isBusy = true
        develop(data)
    }

    private func develop(_ data: Data) {
        let params = renderer.params
        workQueue.async {
            guard let source = CIImage(data: data, options: [.applyOrientationProperty: true]) else {
                self.finish(error: "That image couldn't be read.")
                return
            }
            let output = self.processor.process(source, params: params)
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
            let quality = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
            guard let jpeg = self.processor.context.jpegRepresentation(
                of: output, colorSpace: colorSpace, options: [quality: 0.95]) else {
                self.finish(error: "The photo couldn't be developed.")
                return
            }
            let thumbnail = UIImage(data: jpeg)
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { auth in
                guard auth == .authorized || auth == .limited else {
                    self.finish(thumbnail, error: "Allow Photos access in Settings to save.")
                    return
                }
                PHPhotoLibrary.shared().performChanges({
                    PHAssetCreationRequest.forAsset().addResource(with: .photo, data: jpeg, options: nil)
                }, completionHandler: { saved, _ in
                    self.finish(thumbnail, error: saved ? nil : "Couldn't save to Photos.")
                })
            }
        }
    }

    private func finish(_ image: UIImage? = nil, error: String?) {
        DispatchQueue.main.async {
            self.isBusy = false
            if let image { self.lastPhoto = image }
            self.message = error ?? "Saved to Photos"
        }
    }
}

extension CameraModel: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        renderer.update(frame: CIImage(cvPixelBuffer: buffer))
    }
}

extension CameraModel: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let data = photo.fileDataRepresentation() else {
            finish(error: "The photo couldn't be taken.")
            return
        }
        develop(data)
    }
}
