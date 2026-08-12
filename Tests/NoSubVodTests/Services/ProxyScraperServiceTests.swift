import XCTest
import TSPlayerKit
@testable import NoSubVod

final class ProxyScraperServiceTests: XCTestCase {

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

    private func makeMockSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    private static let geoOK = #"{"ip":"1.2.3.4","country_code":"MD"}"#

    /// The EXACT packer spys.one serves on its country pages (captured from
    /// the live site): it defines the XOR variables the row scripts use to
    /// obfuscate ports. Keys 0-9 and a-z are base36, 36-59 are 'A'-'X'.
    private static let packerFixture = """
    eval(function(p,r,o,x,y,s){y=function(c){return(c<r?'':y(parseInt(c/r)))+((c=c%r)>35?String.fromCharCode(c+29):c.toString(36))};if(!''.replace(/^/,String)){while(o--){s[y(o)]=x[o]||y(o)}x=[function(y){return s[y]}];y=function(){return'\\\\w+'};o=1};while(o--){if(x[o]){p=p.replace(new RegExp('\\\\b'+y(o)+'\\\\b','g'),x[o])}}return p}('s=D^C;k=2;m=B^E;b=3;i=F^A;l=H^G;j=0;d=J^y;p=9;h=1;n=8;f=u^x;g=z^w;e=5;o=v^I;q=T^V;t=6;a=W^X;c=4;r=7;K=j^l;U=h^i;N=k^g;M=b^a;L=c^d;O=e^m;P=t^s;S=r^q;R=n^o;Q=p^f;',60,60,'^^^^^^^^^^Two5Seven^Four^Seven^ZeroThreeNine^Eight^NineEightSix^TwoFiveFour^Nine^FourNineZero^Five^Zero^Three4Two^Nine3Three^One^Three3One^Three^Eight0Five^Two^Six0Eight^Six^6500^5393^81^8000^88^2016^8909^4478^443^3923^1337^604^80^11234^9090^3694^FiveNineTwoFour^FiveFiveSixNine^Eight3FiveOne^ZeroSixOneEight^SixEightEightFive^Four8SevenSeven^Nine8NineZero^Two0ZeroTwo^Five2FourSix^2631^Four5ThreeThree^808^10635^8080'.split('\\\\u005e'),0,{}))
    """

    /// Mirror of a real page body: rows with XOR-obfuscated ports, one plain
    /// `IP:port` row, one SOCKS5 row (must be dropped), an invalid IP and a
    /// duplicate (must be deduped).
    private static let fixtureHTML = """
    <html><head><title>spys.one</title></head><body>
    <script type="text/javascript">\(packerFixture)</script>
    <table>
    <tr class=spy1xx onmouseover="this.style.background='#002424'"><td colspan=1><font class=spy14>176.123.1.101<script>document.write(":"+(Two0ZeroTwo^Three3One)+(FiveNineTwoFour^Three4Two)+(Two0ZeroTwo^Three3One)+(ZeroSixOneEight^TwoFiveFour))</script></font></td><td colspan=1>HTTPS</td></tr>
    <tr class=spy1xx><td colspan=1><font class=spy14>91.212.169.253<script>document.write(":"+(Four5ThreeThree^FourNineZero)+(FiveNineTwoFour^Three4Two)+(Two0ZeroTwo^Three3One)+(ZeroSixOneEight^TwoFiveFour))</script></font></td><td colspan=1>SOCKS5</td></tr>
    <tr><td colspan=1><font class=spy14>10.0.0.1:9999</font></td><td colspan=1>HTTP</td></tr>
    <tr><td colspan=1><font class=spy14>999.1.1.1<script>document.write(":"+(Two0ZeroTwo^Three3One))</script></font></td><td colspan=1>HTTP</td></tr>
    <tr><td colspan=1><font class=spy14>176.123.1.101<script>document.write(":"+(Two0ZeroTwo^Three3One)+(FiveNineTwoFour^Three4Two)+(Two0ZeroTwo^Three3One)+(ZeroSixOneEight^TwoFiveFour))</script></font></td><td colspan=1>HTTPS</td></tr>
    </table>
    </body></html>
    """

    // MARK: - Packer decoding

    func testDecodePacker_handlesRealFormat() {
        let decoded = ProxyScraperService.decodePacker(from: Self.packerFixture)
        XCTAssertNotNil(decoded)
        // Base vars decode to `Name=number;` …
        XCTAssertTrue(decoded!.contains("Six0Eight=3923^443;"))
        XCTAssertTrue(decoded!.contains("Zero=2;"))
        // … compounds reference earlier names.
        XCTAssertTrue(decoded!.contains("SixEightEightFive=Eight^Nine3Three;"))
        XCTAssertTrue(decoded!.contains("Two0ZeroTwo=One^Three3One;"))
    }

    func testDecodePacker_nilWithoutPacker() {
        XCTAssertNil(ProxyScraperService.decodePacker(from: "<html>no packer</html>"))
    }

    // MARK: - Parsing

    func testParseProxies_decodesXORPortsAndSkipsSOCKS() {
        let proxies = ProxyScraperService.parseProxies(from: Self.fixtureHTML)
        // 176.123.1.101 → (One=8)(Five=0)(One=8)(Zero=2) → 8082
        XCTAssertTrue(proxies.contains(HTTPProxy(host: "176.123.1.101", port: 8082)))
        // 91.212.169.253 would decode to 1082 but is SOCKS5 → dropped
        XCTAssertFalse(proxies.contains(HTTPProxy(host: "91.212.169.253", port: 1082)))
        // Plain `IP:port` row
        XCTAssertTrue(proxies.contains(HTTPProxy(host: "10.0.0.1", port: 9999)))
        XCTAssertEqual(proxies.count, 2)
    }

    func testParseProxies_skipsInvalidIPv4() {
        let proxies = ProxyScraperService.parseProxies(from: Self.fixtureHTML)
        XCTAssertFalse(proxies.contains(where: { $0.host == "999.1.1.1" }))
    }

    func testParseProxies_dedupesWithinPage() {
        let proxies = ProxyScraperService.parseProxies(from: Self.fixtureHTML)
        let count = proxies.filter { $0 == HTTPProxy(host: "176.123.1.101", port: 8082) }.count
        XCTAssertEqual(count, 1)
    }

    func testParseProxies_legacyLiteralPorts() {
        // The string-concat format some spys.one pages still use.
        let html = """
        <tr><td class=spy1>195.122.22.47<script type="text/javascript">document.write(":"+"3"+"1"+"2"+"8"+"")</script></td><td class=spy1>HTTP</td></tr>
        """
        let proxies = ProxyScraperService.parseProxies(from: html)
        XCTAssertTrue(proxies.contains(HTTPProxy(host: "195.122.22.47", port: 3128)))
    }

    func testParseProxies_emptyHTML() {
        XCTAssertTrue(ProxyScraperService.parseProxies(from: "").isEmpty)
        XCTAssertTrue(ProxyScraperService.parseProxies(from: "<html>no proxies</html>").isEmpty)
    }

    // MARK: - Fetching

    func testFetchCandidates_mergesPagesAndDedupes() async {
        let md = URL(string: "https://spys.one/free-proxy-list/MD/")!
        let ee = URL(string: "https://spys.one/free-proxy-list/EE/")!
        MockURLProtocol.registerData(url: md, data: Data(Self.fixtureHTML.utf8))
        MockURLProtocol.registerData(url: ee, data: Data(Self.fixtureHTML.utf8))
        // RU + BG are unregistered → transport error → page skipped, not fatal.

        let candidates = await ProxyScraperService.fetchCandidates(session: makeMockSession())
        XCTAssertTrue(candidates.contains(HTTPProxy(host: "176.123.1.101", port: 8082)))
        XCTAssertTrue(candidates.contains(HTTPProxy(host: "10.0.0.1", port: 9999)))
        // Same proxy on two pages → deduped.
        let count = candidates.filter { $0 == HTTPProxy(host: "176.123.1.101", port: 8082) }.count
        XCTAssertEqual(count, 1)
    }

    func testFetchCandidates_emptyWhenAllPagesFail() async {
        let candidates = await ProxyScraperService.fetchCandidates(session: makeMockSession())
        XCTAssertTrue(candidates.isEmpty)
    }

    // MARK: - Validation

    func testFindFirstValid_returnsFirstWorkingProxy() async {
        MockURLProtocol.registerJSON(url: URL(string: "https://ipwho.is/")!, jsonString: Self.geoOK)
        let candidates = [
            HTTPProxy(host: "176.123.1.101", port: 8082),
            HTTPProxy(host: "10.0.0.1", port: 9999),
        ]
        let found = await ProxyScraperService.findFirstValid(candidates, session: makeMockSession())
        XCTAssertEqual(found, candidates[0])
    }

    func testFindFirstValid_nilWhenAllFail() async {
        MockURLProtocol.registerError(
            url: URL(string: "https://ipwho.is/")!,
            error: URLError(.cannotConnectToHost)
        )
        let found = await ProxyScraperService.findFirstValid(
            [HTTPProxy(host: "176.123.1.101", port: 8082)],
            session: makeMockSession()
        )
        XCTAssertNil(found)
    }

    func testFindFirstValid_respectsMaxAttempts() async {
        MockURLProtocol.registerError(
            url: URL(string: "https://ipwho.is/")!,
            error: URLError(.cannotConnectToHost)
        )
        let candidates = (0..<20).map { HTTPProxy(host: "10.0.0.\($0)", port: 3128) }
        let found = await ProxyScraperService.findFirstValid(candidates, maxAttempts: 3, session: makeMockSession())
        XCTAssertNil(found)
        XCTAssertEqual(MockURLProtocol.callCounts[URL(string: "https://ipwho.is/")!], 3)
    }
}
