import Foundation
import CoreGraphics
import ImageIO
import Vision

func die(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    die("usage: ocr-cli <image-path>", code: 2)
}

let imagePath = args[1]
let url = URL(fileURLWithPath: imagePath)

guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
    die("failed to open image: \(imagePath)", code: 1)
}
guard let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    die("failed to decode image: \(imagePath)", code: 1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 13, *) {
    request.revision = VNRecognizeTextRequestRevision3
} else if #available(macOS 11, *) {
    request.revision = VNRecognizeTextRequestRevision2
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    die("OCR request failed: \(error.localizedDescription)", code: 1)
}

let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
