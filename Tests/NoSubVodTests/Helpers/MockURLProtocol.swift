import Foundation
import XCTest

final class MockURLProtocol: URLProtocol {

    static var responses: [URL: Result<(HTTPURLResponse, Data), Error>] = [:]

    static var callCounts: [URL: Int] = [:]

    static func reset() {
        responses.removeAll()
        callCounts.removeAll()
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

        MockURLProtocol.callCounts[url, default: 0] += 1

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
