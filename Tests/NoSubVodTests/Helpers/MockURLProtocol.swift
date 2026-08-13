import Foundation
import XCTest

final class MockURLProtocol: URLProtocol {

    static var responses: [URL: Result<(HTTPURLResponse, Data), Error>] = [:]

    static var callCounts: [URL: Int] = [:]
    /// Dernier corps de requête POST capturé — permet d'asserter les requêtes
    /// GQL sortantes (ex: valeur d'un enum de tri) dans les tests de régression.
    static var lastRequestBody: Data?
    // URLProtocol hooks fire on arbitrary URLSession threads. The counters
    // are mutated concurrently (e.g. findFirstValid validates in parallel).
    private static let lock = NSLock()

    static func reset() {
        lock.lock()
        responses.removeAll()
        callCounts.removeAll()
        lastRequestBody = nil
        lock.unlock()
    }
    static func registerJSON(url: URL, jsonString: String, statusCode: Int = 200) {
        let data = Data(jsonString.utf8)
        let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        responses[url] = .success((response, data))
    }

    static func registerData(url: URL, data: Data, statusCode: Int = 200) {
        let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
        responses[url] = .success((response, data))
    }

    static func registerError(url: URL, error: Error) {
        responses[url] = .failure(error)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocolDidFinishLoading(self)
            return
        }

        MockURLProtocol.lock.lock()
        MockURLProtocol.callCounts[url, default: 0] += 1
        // URLSession canonise le corps POST en httpBodyStream avant
        // URLProtocol → lire le flux quand httpBody est nil.
        if let body = request.httpBody {
            MockURLProtocol.lastRequestBody = body
        } else if let stream = request.httpBodyStream {
            stream.open()
            var body = Data()
            let bufferSize = 4096
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
            defer {
                buffer.deallocate()
                stream.close()
            }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: bufferSize)
                if count <= 0 { break }
                body.append(buffer, count: count)
            }
            MockURLProtocol.lastRequestBody = body
        }
        MockURLProtocol.lock.unlock()

        guard let result = MockURLProtocol.responses[url] else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }

        switch result {
        case .success(let (response, data)):
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
