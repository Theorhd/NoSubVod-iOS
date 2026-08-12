import XCTest
import TSPlayerKit
@testable import NoSubVod

final class ExternalProxyServiceTests: XCTestCase {

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        // Device's own public IP: preset so validation never hits the
        // network for it. "9.9.9.9" differs from every fixture egress IP.
        UserDefaults.standard.set("9.9.9.9", forKey: ExternalProxyService.ownIPCacheKey)
        UserDefaults.standard.set(Date(), forKey: ExternalProxyService.ownIPCacheTimestampKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: ExternalProxyService.ownIPCacheKey)
        UserDefaults.standard.removeObject(forKey: ExternalProxyService.ownIPCacheTimestampKey)
        super.tearDown()
    }

    // MARK: - Parsing

    func testParse_hostPort() {
        XCTAssertEqual(
            ExternalProxyService.parse("195.12.3.4:3128"),
            HTTPProxy(host: "195.12.3.4", port: 3128)
        )
    }

    func testParse_hostnamePort() {
        XCTAssertEqual(
            ExternalProxyService.parse("myproxy.example.com:8080"),
            HTTPProxy(host: "myproxy.example.com", port: 8080)
        )
    }

    func testParse_withScheme() {
        XCTAssertEqual(
            ExternalProxyService.parse("http://195.12.3.4:3128"),
            HTTPProxy(host: "195.12.3.4", port: 3128)
        )
        XCTAssertEqual(
            ExternalProxyService.parse("https://proxy.example.com:443"),
            HTTPProxy(host: "proxy.example.com", port: 443)
        )
    }

    func testParse_withTrailingSlash() {
        XCTAssertEqual(
            ExternalProxyService.parse("http://195.12.3.4:3128/"),
            HTTPProxy(host: "195.12.3.4", port: 3128)
        )
    }

    func testParse_trimsWhitespace() {
        XCTAssertEqual(
            ExternalProxyService.parse("  195.12.3.4:3128  "),
            HTTPProxy(host: "195.12.3.4", port: 3128)
        )
    }

    func testParse_rejectsSOCKS() {
        XCTAssertNil(ExternalProxyService.parse("socks5://1.2.3.4:1080"))
    }

    func testParse_rejectsMissingPort() {
        XCTAssertNil(ExternalProxyService.parse("1.2.3.4"))
    }

    func testParse_rejectsInvalidPort() {
        XCTAssertNil(ExternalProxyService.parse("1.2.3.4:0"))
        XCTAssertNil(ExternalProxyService.parse("1.2.3.4:70000"))
        XCTAssertNil(ExternalProxyService.parse("1.2.3.4:"))
    }

    func testParse_rejectsEmpty() {
        XCTAssertNil(ExternalProxyService.parse(""))
        XCTAssertNil(ExternalProxyService.parse("   "))
    }

    // MARK: - Validation

    private func makeMockSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    func testValidate_adFreeCountry() async throws {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://ipwho.is/")!,
            jsonString: #"{"ip":"1.2.3.4","country_code":"MD"}"#
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession()
        )
        XCTAssertEqual(result.status, .ok(countryCode: "MD"))
    }

    func testValidate_notAdFreeCountry() async throws {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://ipwho.is/")!,
            jsonString: #"{"ip":"1.2.3.4","country_code":"FR"}"#
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession()
        )
        XCTAssertEqual(result.status, .notAdFree(countryCode: "FR"))
    }

    func testValidate_lowercaseCountryCode() async throws {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://ipwho.is/")!,
            jsonString: #"{"ip":"1.2.3.4","country_code":"ee"}"#
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession()
        )
        XCTAssertEqual(result.status, .ok(countryCode: "EE"))
    }

    func testValidate_unreachableProxy() async {
        MockURLProtocol.registerError(
            url: URL(string: "https://ipwho.is/")!,
            error: URLError(.cannotConnectToHost)
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession()
        )
        XCTAssertEqual(result.status, .unreachable)
    }

    func testValidate_httpErrorIsUnreachable() async {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://ipwho.is/")!,
            jsonString: #"{"error":true}"#,
            statusCode: 500
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession()
        )
        XCTAssertEqual(result.status, .unreachable)
    }

    func testValidate_proxyUnusedWhenEgressMatchesOwnIP() async {
        // The proxy is dead → CFNetwork fell back to a direct connection →
        // ipwho.is answers with the device's OWN public IP. The country
        // verdict would be misleading (user's country, e.g. KH) → unreachable.
        UserDefaults.standard.set("1.2.3.4", forKey: ExternalProxyService.ownIPCacheKey)
        MockURLProtocol.registerJSON(
            url: URL(string: "https://ipwho.is/")!,
            jsonString: #"{"ip":"1.2.3.4","country_code":"MD"}"#
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession()
        )
        XCTAssertEqual(result.status, .unreachable)
    }

    func testValidate_refreshesStaleOwnIPCache() async {
        // Own IP cached but expired → refreshed from the injected session.
        UserDefaults.standard.set("9.9.9.9", forKey: ExternalProxyService.ownIPCacheKey)
        UserDefaults.standard.set(Date(timeIntervalSince1970: 1), forKey: ExternalProxyService.ownIPCacheTimestampKey)
        MockURLProtocol.registerData(
            url: URL(string: "https://api.ipify.org")!,
            data: Data("7.7.7.7".utf8)
        )
        MockURLProtocol.registerJSON(
            url: URL(string: "https://ipwho.is/")!,
            jsonString: #"{"ip":"1.2.3.4","country_code":"MD"}"#
        )
        let result = await ExternalProxyService.validate(
            HTTPProxy(host: "195.12.3.4", port: 3128),
            session: makeMockSession(),
            ownIPSession: makeMockSession()
        )
        XCTAssertEqual(result.status, .ok(countryCode: "MD"))
        XCTAssertEqual(UserDefaults.standard.string(forKey: ExternalProxyService.ownIPCacheKey), "7.7.7.7")
    }

    func testOwnPublicIP_fetchesAndCaches() async {
        UserDefaults.standard.removeObject(forKey: ExternalProxyService.ownIPCacheKey)
        MockURLProtocol.registerData(
            url: URL(string: "https://api.ipify.org")!,
            data: Data("7.7.7.7\n".utf8)
        )
        let ip = await ExternalProxyService.ownPublicIP(session: makeMockSession())
        XCTAssertEqual(ip, "7.7.7.7")
        XCTAssertEqual(UserDefaults.standard.string(forKey: ExternalProxyService.ownIPCacheKey), "7.7.7.7")
    }

    func testOwnPublicIP_nilOnFailureAndDoesNotCache() async {
        UserDefaults.standard.removeObject(forKey: ExternalProxyService.ownIPCacheKey)
        MockURLProtocol.registerError(
            url: URL(string: "https://api.ipify.org")!,
            error: URLError(.cannotConnectToHost)
        )
        let ip = await ExternalProxyService.ownPublicIP(session: makeMockSession())
        XCTAssertNil(ip)
        XCTAssertNil(UserDefaults.standard.string(forKey: ExternalProxyService.ownIPCacheKey))
    }

    // MARK: - AdBlockMode integration

    func testAdBlockMode_externalRawValueRoundTrips() {
        XCTAssertEqual(AdBlockMode(rawValue: "external"), .external)
        XCTAssertEqual(AdBlockMode.external.rawValue, "external")
    }
}
