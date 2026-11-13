import SwiftUI
import PhotosUI

struct ContentView: View {
    @StateObject private var camera = CameraModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var pickerItem: PhotosPickerItem?
    @State private var showControls = false
    @State private var showPhoto = false
    @State private var shutterFlash = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 14) {
                topBar
                preview
                lookPicker
                if showControls { sliders }
                bottomBar
            }
            .padding(.vertical, 8)
        }
        .onAppear { camera.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { camera.start() } else if phase == .background { camera.stop() }
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    camera.develop(imported: data)
                } else {
                    camera.message = "That image couldn't be read."
                }
                pickerItem = nil
            }
        }
        .onChange(of: camera.message) { _, message in
            guard let message else { return }
            Task {
                try? await Task.sleep(for: .seconds(2))
                if camera.message == message { camera.message = nil }
            }
        }
        .fullScreenCover(isPresented: $showPhoto) { photoViewer }
    }

    // MARK: Sections

    private var topBar: some View {
        HStack {
            Picker("Format", selection: $camera.format) {
                ForEach(FrameFormat.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(width: 130)
            Spacer()
            Text(camera.message ?? "")
                .font(.caption.monospaced())
                .foregroundStyle(.white.opacity(0.8))
            Spacer()
            Button {
                withAnimation { showControls.toggle() }
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.title3)
                    .foregroundStyle(showControls ? .yellow : .white)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Adjustments")
        }
        .padding(.horizontal, 16)
    }

    private var preview: some View {
        ZStack {
            Color.black
            switch camera.status {
            case .running:
                PreviewView(renderer: camera.renderer)
                    .aspectRatio(1 / camera.format.ratio, contentMode: .fit)
                    .overlay {
                        GeometryReader { geo in
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture { location in
                                    camera.focus(at: CGPoint(x: location.x / geo.size.width,
                                                             y: location.y / geo.size.height))
                                }
                        }
                    }
                    .overlay(alignment: .bottom) { lensPicker }
                    .overlay { Color.black.opacity(shutterFlash ? 1 : 0) }
            case .starting:
                ProgressView().tint(.white)
            case .denied:
                notice("Camera access is off.\nTurn it on in Settings → Soy Cuba, or import a photo below.")
            case .unavailable:
                notice("No camera on this device.\nImport a photo below to develop it.")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func notice(_ text: String) -> some View {
        Text(text)
            .font(.callout)
            .multilineTextAlignment(.center)
            .foregroundStyle(.white.opacity(0.7))
            .padding()
    }

    private var lensPicker: some View {
        HStack(spacing: 10) {
            if camera.lenses.count > 1 {
                ForEach(camera.lenses) { lens in
                    Button { camera.select(lens) } label: {
                        Text(lens.label)
                            .font(.caption.bold().monospaced())
                            .foregroundStyle(lens.id == camera.lensID ? .yellow : .white)
                            .frame(minWidth: 40, minHeight: 40)
                            .background(.black.opacity(0.5), in: Circle())
                    }
                }
            }
        }
        .padding(.bottom, 10)
    }

    private var lookPicker: some View {
        HStack(spacing: 28) {
            ForEach(FilmLook.all) { look in
                Button { camera.look = look } label: {
                    VStack(spacing: 2) {
                        Text(look.name).font(.subheadline.bold()).tracking(2)
                        Text(look.detail).font(.caption2)
                    }
                    .foregroundStyle(look == camera.look ? .yellow : .white.opacity(0.55))
                    .frame(minHeight: 44)
                }
            }
        }
    }

    private var sliders: some View {
        VStack(spacing: 6) {
            slider("Exposure", value: $camera.exposureBias, range: -2...2, reset: 0)
            slider("Grain", value: $camera.grain, range: 0...2, reset: 1)
            slider("Glow", value: $camera.glow, range: 0...2, reset: 1)
        }
        .padding(.horizontal, 20)
    }

    private func slider(_ title: String, value: Binding<Float>, range: ClosedRange<Float>, reset: Float) -> some View {
        HStack {
            Text(title)
                .font(.caption.monospaced())
                .foregroundStyle(.white.opacity(0.7))
                .frame(width: 70, alignment: .leading)
                .onTapGesture(count: 2) { value.wrappedValue = reset }
            Slider(value: value, in: range).tint(.white)
        }
    }

    private var bottomBar: some View {
        HStack {
            HStack(spacing: 14) {
                Button { showPhoto = true } label: {
                    Group {
                        if let photo = camera.lastPhoto {
                            Image(uiImage: photo).resizable().scaledToFill()
                        } else {
                            Color.white.opacity(0.1)
                        }
                    }
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .disabled(camera.lastPhoto == nil)
                .accessibilityLabel("Last photo")
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.title3)
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Import a photo")
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                shutterFlash = true
                withAnimation(.easeOut(duration: 0.25)) { shutterFlash = false }
                camera.capture()
            } label: {
                ZStack {
                    Circle().stroke(.white, lineWidth: 4).frame(width: 76, height: 76)
                    Circle().fill(.white).frame(width: 62, height: 62)
                    if camera.isBusy { ProgressView().tint(.black) }
                }
            }
            .disabled(camera.status != .running || camera.isBusy)
            .opacity(camera.status == .running ? 1 : 0.3)
            .accessibilityLabel("Take photo")

            Button { camera.flip() } label: {
                Image(systemName: "arrow.triangle.2.circlepath.camera")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
            }
            .disabled(camera.status != .running)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityLabel("Switch camera")
        }
        .padding(.horizontal, 24)
    }

    private var photoViewer: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let photo = camera.lastPhoto {
                Image(uiImage: photo)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button { showPhoto = false } label: {
                Image(systemName: "xmark")
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.5), in: Circle())
            }
            .padding()
            .accessibilityLabel("Close")
        }
    }
}
