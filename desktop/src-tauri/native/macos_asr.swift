import AVFoundation
import CoreMedia
import Darwin
import Foundation
import Speech

@_silgen_name("coworkany_native_asr_on_segment")
private func coworkany_native_asr_on_segment(
    _ text: UnsafePointer<CChar>?,
    _ locale: UnsafePointer<CChar>?,
    _ confidence: Float
)

@_silgen_name("coworkany_native_asr_log")
private func coworkany_native_asr_log(_ message: UnsafePointer<CChar>?)

private struct NativeAsrBridgeError: Error {
    let code: String
    let message: String
}

private func duplicateCString(_ value: String) -> UnsafeMutablePointer<CChar>? {
    strdup(value)
}

private func setError(
    _ errorCode: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?,
    _ errorMessage: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?,
    code: String,
    message: String
) {
    errorCode?.pointee = duplicateCString(code)
    errorMessage?.pointee = duplicateCString(message)
}

private func logNativeAsr(_ message: String) {
    message.withCString { coworkany_native_asr_log($0) }
}

private func withOptionalCString<R>(_ value: String?, _ body: (UnsafePointer<CChar>?) -> R) -> R {
    guard let value else {
        return body(nil)
    }
    return value.withCString(body)
}

private func normalizeLocaleIdentifier(_ value: String?) -> String {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if trimmed.isEmpty {
        let system = Locale.current.identifier.lowercased()
        if system.hasPrefix("zh") {
            return "zh-CN"
        }
        if system.hasPrefix("en") {
            return "en-US"
        }
        return Locale.current.identifier
    }

    switch trimmed.lowercased() {
    case "zh":
        return "zh-CN"
    case "en":
        return "en-US"
    default:
        return trimmed
    }
}

private func requestSpeechAuthorization() -> SFSpeechRecognizerAuthorizationStatus {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status != .notDetermined {
        return status
    }

    let semaphore = DispatchSemaphore(value: 0)
    var resolved = SFSpeechRecognizerAuthorizationStatus.notDetermined
    SFSpeechRecognizer.requestAuthorization { authStatus in
        resolved = authStatus
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 5)
    return resolved
}

private func requestMicrophoneAuthorization() -> AVAuthorizationStatus {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    if status != .notDetermined {
        return status
    }

    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { accessGranted in
        granted = accessGranted
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 5)
    return granted ? .authorized : .denied
}

private func waitAsync<T>(_ operation: @escaping () async throws -> T) -> Result<T, Error> {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<T, Error>!
    Task {
        do {
            result = .success(try await operation())
        } catch {
            result = .failure(error)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return result
}

@available(macOS 26.0, *)
private final class NativeSpeechSession {
    private let lock = NSLock()

    private var audioEngine: AVAudioEngine?
    private var analyzer: SpeechAnalyzer?
    private var detector: SpeechDetector?
    private var transcriber: SpeechTranscriber?
    private var streamContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzerTask: Task<Void, Never>?
    private var detectorTask: Task<Void, Never>?
    private var transcriberTask: Task<Void, Never>?
    private var currentLocaleIdentifier = "en-US"
    private var isListening = false
    private var emittedSegmentKeys = Set<String>()
    private var hasEmittedSegment = false
    private var pendingPartialText = ""
    private var pendingPartialRangeKey = ""
    private var pendingPartialConfidence: Float = 0
    private var stopTranscript = ""
    private var lastError: NativeAsrBridgeError?

    func start(localeHint: String?) throws {
        lock.lock()
        if isListening {
            lock.unlock()
            throw NativeAsrBridgeError(code: "already_listening", message: "Native speech recognition is already running.")
        }
        lock.unlock()

        let speechStatus = requestSpeechAuthorization()
        guard speechStatus == .authorized else {
            throw NativeAsrBridgeError(
                code: speechStatus == .denied || speechStatus == .restricted ? "speech_permission_denied" : "speech_not_supported",
                message: "Speech recognition permission was denied."
            )
        }

        let microphoneStatus = requestMicrophoneAuthorization()
        guard microphoneStatus == .authorized else {
            throw NativeAsrBridgeError(code: "microphone_denied", message: "Microphone permission was denied.")
        }

        let resolvedLocaleIdentifier = normalizeLocaleIdentifier(localeHint)
        logNativeAsr("swift_start requested_locale=\(resolvedLocaleIdentifier)")

        let requestedLocale = Locale(identifier: resolvedLocaleIdentifier)
        let supportedLocale = try waitAsync {
            await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale)
        }.get() ?? requestedLocale

        let reportingOptions: Set<SpeechTranscriber.ReportingOption> = [.volatileResults, .fastResults]
        let attributeOptions: Set<SpeechTranscriber.ResultAttributeOption> = [.audioTimeRange, .transcriptionConfidence]
        let transcriber = SpeechTranscriber(
            locale: supportedLocale,
            transcriptionOptions: [],
            reportingOptions: reportingOptions,
            attributeOptions: attributeOptions
        )
        let detector = SpeechDetector(
            detectionOptions: .init(sensitivityLevel: .medium),
            reportResults: true
        )
        let modules: [any SpeechModule] = [detector, transcriber]

        let assetStatus = try waitAsync {
            await AssetInventory.status(forModules: modules)
        }.get()
        logNativeAsr("swift_assets locale=\(supportedLocale.identifier) status=\(assetStatus)")
        if assetStatus == .unsupported {
            throw NativeAsrBridgeError(code: "speech_not_supported", message: "Speech assets are unavailable for the selected locale.")
        }
        if assetStatus == .supported {
            throw NativeAsrBridgeError(code: "speech_assets_missing", message: "Speech assets are not installed for the selected locale.")
        }

        let analyzer = SpeechAnalyzer(
            modules: modules,
            options: .init(priority: .userInitiated, modelRetention: .whileInUse)
        )

        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        let analyzerFormat = try waitAsync {
            await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules, considering: inputFormat)
        }.get() ?? inputFormat

        let stream = AsyncStream<AnalyzerInput> { continuation in
            self.streamContinuation = continuation
        }

        try waitAsync {
            try await analyzer.prepareToAnalyze(in: analyzerFormat)
        }.get()

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: analyzerFormat) { [weak self] buffer, _ in
            guard let self, let copiedBuffer = self.copyBuffer(buffer) else {
                return
            }
            self.streamContinuation?.yield(AnalyzerInput(buffer: copiedBuffer))
        }

        audioEngine.prepare()
        try audioEngine.start()

        lock.lock()
        self.audioEngine = audioEngine
        self.analyzer = analyzer
        self.detector = detector
        self.transcriber = transcriber
        self.currentLocaleIdentifier = supportedLocale.identifier
        self.isListening = true
        self.hasEmittedSegment = false
        self.emittedSegmentKeys.removeAll()
        self.pendingPartialText = ""
        self.pendingPartialRangeKey = ""
        self.pendingPartialConfidence = 0
        self.stopTranscript = ""
        self.lastError = nil
        lock.unlock()

        self.transcriberTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    self?.handleTranscriberResult(result)
                }
            } catch {
                self?.recordError(code: "native_asr_failed", message: error.localizedDescription)
            }
        }

        self.detectorTask = Task { [weak self] in
            do {
                for try await result in detector.results {
                    self?.handleDetectorResult(result)
                }
            } catch {
                self?.recordError(code: "native_asr_failed", message: error.localizedDescription)
            }
        }

        self.analyzerTask = Task { [weak self] in
            do {
                try await analyzer.start(inputSequence: stream)
            } catch {
                self?.recordError(code: "native_asr_failed", message: error.localizedDescription)
            }
        }

        logNativeAsr("swift_start ready locale=\(supportedLocale.identifier)")
    }

    func stop() -> Result<String, NativeAsrBridgeError> {
        lock.lock()
        guard isListening else {
            lock.unlock()
            return .failure(NativeAsrBridgeError(code: "not_listening", message: "Native speech recognition is not running."))
        }

        let audioEngine = self.audioEngine
        let analyzer = self.analyzer
        let pendingText = self.pendingPartialText
        self.isListening = false
        self.audioEngine = nil
        self.analyzer = nil
        self.detector = nil
        self.transcriber = nil
        let continuation = self.streamContinuation
        self.streamContinuation = nil
        let analyzerTask = self.analyzerTask
        let detectorTask = self.detectorTask
        let transcriberTask = self.transcriberTask
        self.analyzerTask = nil
        self.detectorTask = nil
        self.transcriberTask = nil
        lock.unlock()

        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        continuation?.finish()

        if let analyzer {
            _ = waitAsync {
                try await analyzer.finalizeAndFinishThroughEndOfInput()
            }
        }

        analyzerTask?.cancel()
        detectorTask?.cancel()
        transcriberTask?.cancel()

        lock.lock()
        let stopResolved = stopTranscript.isEmpty ? pendingText : stopTranscript
        let emittedDuringSession = hasEmittedSegment
        let currentError = lastError
        pendingPartialText = ""
        pendingPartialRangeKey = ""
        pendingPartialConfidence = 0
        stopTranscript = ""
        lastError = nil
        lock.unlock()

        if !stopResolved.isEmpty {
            logNativeAsr("swift_stop resolved text=\(stopResolved)")
            return .success(stopResolved)
        }
        if emittedDuringSession {
            logNativeAsr("swift_stop resolved empty after emitted segments")
            return .success("")
        }
        if let currentError {
            return .failure(currentError)
        }
        return .failure(NativeAsrBridgeError(code: "no_speech", message: "No speech detected."))
    }

    private func handleTranscriberResult(_ result: SpeechTranscriber.Result) {
        let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            return
        }

        let rangeKey = Self.rangeKey(for: result.range)
        let confidence = Self.extractConfidence(from: result.text)
        logNativeAsr("swift_transcriber locale=\(currentLocaleIdentifier) final=\(result.isFinal ? 1 : 0) confidence=\(confidence) range=\(rangeKey) text=\(text)")

        lock.lock()
        pendingPartialText = text
        pendingPartialRangeKey = rangeKey
        pendingPartialConfidence = confidence
        lock.unlock()

        guard result.isFinal else {
            return
        }

        emitSegmentIfNeeded(text: text, rangeKey: rangeKey, confidence: confidence)
    }

    private func handleDetectorResult(_ result: SpeechDetector.Result) {
        let rangeKey = Self.rangeKey(for: result.range)
        logNativeAsr("swift_detector speech=\(result.speechDetected ? 1 : 0) final=\(result.isFinal ? 1 : 0) range=\(rangeKey)")

        guard result.isFinal, result.speechDetected == false else {
            return
        }

        lock.lock()
        let text = pendingPartialText
        let pendingRangeKey = pendingPartialRangeKey
        let confidence = pendingPartialConfidence
        lock.unlock()

        guard !text.isEmpty else {
            return
        }

        emitSegmentIfNeeded(text: text, rangeKey: pendingRangeKey.isEmpty ? rangeKey : pendingRangeKey, confidence: confidence)
    }

    private func emitSegmentIfNeeded(text: String, rangeKey: String, confidence: Float) {
        guard !text.isEmpty else {
            return
        }

        lock.lock()
        if emittedSegmentKeys.contains(rangeKey) {
            lock.unlock()
            return
        }
        emittedSegmentKeys.insert(rangeKey)
        hasEmittedSegment = true
        pendingPartialText = ""
        pendingPartialRangeKey = ""
        pendingPartialConfidence = 0
        stopTranscript = ""
        let localeIdentifier = currentLocaleIdentifier
        lock.unlock()

        logNativeAsr("swift_emit locale=\(localeIdentifier) confidence=\(confidence) range=\(rangeKey) text=\(text)")
        withOptionalCString(text) { textCString in
            withOptionalCString(localeIdentifier) { localeCString in
                coworkany_native_asr_on_segment(textCString, localeCString, confidence)
            }
        }
    }

    private func recordError(code: String, message: String) {
        lock.lock()
        if lastError == nil {
            lastError = NativeAsrBridgeError(code: code, message: message)
        }
        lock.unlock()
        logNativeAsr("swift_error code=\(code) message=\(message)")
    }

    private func copyBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
            return nil
        }

        copy.frameLength = buffer.frameLength
        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)

        if let source = buffer.floatChannelData, let target = copy.floatChannelData {
            let byteCount = frameCount * MemoryLayout<Float>.size
            for channel in 0..<channelCount {
                memcpy(target[channel], source[channel], byteCount)
            }
            return copy
        }

        if let source = buffer.int16ChannelData, let target = copy.int16ChannelData {
            let byteCount = frameCount * MemoryLayout<Int16>.size
            for channel in 0..<channelCount {
                memcpy(target[channel], source[channel], byteCount)
            }
            return copy
        }

        if let source = buffer.int32ChannelData, let target = copy.int32ChannelData {
            let byteCount = frameCount * MemoryLayout<Int32>.size
            for channel in 0..<channelCount {
                memcpy(target[channel], source[channel], byteCount)
            }
            return copy
        }

        logNativeAsr("swift_copy_buffer unsupported_format")
        return nil
    }

    private static func rangeKey(for range: CMTimeRange) -> String {
        let start = CMTimeGetSeconds(range.start)
        let duration = CMTimeGetSeconds(range.duration)
        if !start.isFinite || !duration.isFinite {
            return UUID().uuidString
        }
        return String(format: "%.3f-%.3f", start, duration)
    }

    private static func extractConfidence(from text: AttributedString) -> Float {
        let key = AttributeScopes.SpeechAttributes.ConfidenceAttribute.self
        var total = 0.0
        var count = 0

        for run in text.runs {
            if let confidence = run[key] {
                total += confidence
                count += 1
            }
        }

        guard count > 0 else {
            return 0
        }
        return Float(total / Double(count))
    }
}

@available(macOS 26.0, *)
private let nativeSpeechSession = NativeSpeechSession()

@_cdecl("coworkany_macos_native_asr_is_supported")
public func coworkany_macos_native_asr_is_supported() -> Bool {
    if #available(macOS 26.0, *) {
        return true
    }
    return false
}

@_cdecl("coworkany_macos_native_asr_start")
public func coworkany_macos_native_asr_start(
    _ locale: UnsafePointer<CChar>?,
    _ errorCode: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?,
    _ errorMessage: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> Bool {
    guard #available(macOS 26.0, *) else {
        setError(errorCode, errorMessage, code: "speech_not_supported", message: "SpeechAnalyzer requires macOS 26 or newer.")
        return false
    }

    let localeHint = locale.map { String(cString: $0) }
    do {
        try nativeSpeechSession.start(localeHint: localeHint)
        return true
    } catch let error as NativeAsrBridgeError {
        setError(errorCode, errorMessage, code: error.code, message: error.message)
        return false
    } catch {
        setError(errorCode, errorMessage, code: "native_asr_failed", message: error.localizedDescription)
        return false
    }
}

@_cdecl("coworkany_macos_native_asr_stop")
public func coworkany_macos_native_asr_stop(
    _ transcript: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?,
    _ errorCode: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?,
    _ errorMessage: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> Bool {
    guard #available(macOS 26.0, *) else {
        setError(errorCode, errorMessage, code: "speech_not_supported", message: "SpeechAnalyzer requires macOS 26 or newer.")
        return false
    }

    switch nativeSpeechSession.stop() {
    case .success(let text):
        transcript?.pointee = duplicateCString(text)
        return true
    case .failure(let error):
        setError(errorCode, errorMessage, code: error.code, message: error.message)
        return false
    }
}

@_cdecl("coworkany_macos_native_asr_free_string")
public func coworkany_macos_native_asr_free_string(_ value: UnsafeMutablePointer<CChar>?) {
    guard let value else {
        return
    }
    free(value)
}
