import Foundation
import TSPlayerKit

/// Validates and parses the external HTTP proxy used by the `.external`
/// ad-block mode: the stream must leave the proxy from a country where
/// Twitch serves no ads, or the geo trick is pointless.
enum ExternalProxyService {

    /// Countries with no Twitch ads recorded over 12 months (cdn-perfprod
    /// wiki). KR stays excluded: ad-free but capped at 720p. RU is kept —
    /// also 720p-capped — because the user-provided lists (spys.one/RU)
    /// rely on it.
    static let adFreeCountryCodes: Set<String> = [
        "MD", "AL", "BY", "RO", "LV", "LT", "EE", "BG", "SI", "IS",
        "PT", "HR", "MK", "GE", "AM", "KZ", "SC", "RU",
    ]

    enum ValidationStatus: Equatable {
        /// The proxy egress IP is in an ad-free country.
        case ok(countryCode: String)
        /// The proxy is reachable but exits in a country that still gets ads.
        case notAdFree(countryCode: String)
        /// The proxy could not be reached (down, wrong port, blocked CONNECT).
        case unreachable
    }

    struct ValidationResult: Equatable {
        let status: ValidationStatus
    }

    /// The geo endpoint is queried THROUGH the proxy, so it reports the
    /// proxy's egress location, not the phone's. HTTPS so it goes through a
    /// Squid CONNECT tunnel like the rest of the stream traffic.
    private static let geoEndpoint: URL? = URL(string: "https://ipwho.is/")
    /// Plain-text endpoint for the device's OWN public IP — used to detect
    /// when a request bypassed the proxy (see `validate`). ipwho.is would
    /// answer with the same IP either way, so a distinct service is needed.
    private static let ownIPEndpoint: URL? = URL(string: "https://api.ipify.org")
    static let ownIPCacheKey = "externalProxyOwnIP"
    static let ownIPCacheTimestampKey = "externalProxyOwnIPTimestamp"
    private static let ownIPCacheValidity: TimeInterval = 24 * 3600

    private struct GeoResponse: Decodable {
        let ip: String
        let countryCode: String
        enum CodingKeys: String, CodingKey {
            case ip
            case countryCode = "country_code"
        }
    }

    /// Parses `host:port` — lenient about an optional `http(s)://` scheme and
    /// a trailing slash. SOCKS proxies are rejected: URLSession does not
    /// route them through `connectionProxyDictionary`.
    static func parse(_ raw: String) -> HTTPProxy? {
        var input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return nil }
        if input.hasPrefix("http://") {
            input = String(input.dropFirst("http://".count))
        } else if input.hasPrefix("https://") {
            input = String(input.dropFirst("https://".count))
        } else if input.contains("://") {
            return nil
        }
        // Drop any trailing path ("host:3128/", "host:3128/squid").
        if let slash = input.firstIndex(of: "/") { input = String(input[..<slash]) }
        guard let colon = input.lastIndex(of: ":") else { return nil }
        let host = String(input[..<colon])
        guard let port = Int(input[input.index(after: colon)...]), (1...65535).contains(port) else { return nil }
        return HTTPProxy(host: host, port: port)
    }

    /// Checks whether the proxy is reachable AND actually used, and exits in
    /// an ad-free country. Inject a session in tests (MockURLProtocol); the
    /// default session is configured to route through `proxy`.
    ///
    /// Dead or refusing proxies make CFNetwork fall back to a direct
    /// connection: the geo check then answers with the DEVICE's own country
    /// (e.g. "KH"), not the proxy's — a misleading "not ad-free" verdict.
    /// The through-proxy response's egress IP must therefore differ from the
    /// device's public IP, otherwise the proxy is treated as unreachable.
    static func validate(_ proxy: HTTPProxy, session: URLSession? = nil, ownIPSession: URLSession? = nil, timeout: TimeInterval = 8) async -> ValidationResult {
        let urlSession = session ?? makeSession(proxy: proxy, timeout: timeout)
        do {
            guard let endpoint = geoEndpoint else { return ValidationResult(status: .unreachable) }
            let (data, response) = try await urlSession.data(from: endpoint)
            // Échec de parse → verdict unreachable, fallback prévu
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let geo = try? JSONDecoder().decode(GeoResponse.self, from: data) else {
                return ValidationResult(status: .unreachable)
            }
            if let ownIP = await ownPublicIP(session: ownIPSession), geo.ip == ownIP {
                return ValidationResult(status: .unreachable)
            }
            let code = geo.countryCode.uppercased()
            let status: ValidationStatus = adFreeCountryCodes.contains(code)
                ? .ok(countryCode: code)
                : .notAdFree(countryCode: code)
            return ValidationResult(status: status)
        } catch {
            return ValidationResult(status: .unreachable)
        }
    }

    /// The device's own public IP (api.ipify.org), cached 24 h — the value
    /// itself barely ever changes, only the route to it does. Injected
    /// session for tests; returns nil when unknown, which disables the
    /// proxy-unused check rather than failing validation.
    static func ownPublicIP(session: URLSession? = nil) async -> String? {
        let defaults = UserDefaults.standard
        if let cached = defaults.string(forKey: ownIPCacheKey),
           let stamp = defaults.object(forKey: ownIPCacheTimestampKey) as? Date,
           Date().timeIntervalSince(stamp) < ownIPCacheValidity {
            return cached
        }
        let urlSession = session ?? URLSession(configuration: .ephemeral)
        guard let endpoint = ownIPEndpoint else { return nil }
        // Échec de parse → verdict unreachable, fallback prévu
        guard let (data, response) = try? await urlSession.data(from: endpoint),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let ip = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !ip.isEmpty else {
            return nil
        }
        defaults.set(ip, forKey: ownIPCacheKey)
        defaults.set(Date(), forKey: ownIPCacheTimestampKey)
        return ip
    }

    private static func makeSession(proxy: HTTPProxy, timeout: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        // Same wiring as RemotePlaylistFetcher: plain HTTP through the proxy,
        // HTTPS tunneled with CONNECT. On iOS the HTTP keys alone cover HTTPS;
        // the HTTPS keys are macOS-only constants.
        var proxyDict: [AnyHashable: Any] = [
            kCFNetworkProxiesHTTPEnable: true,
            kCFNetworkProxiesHTTPProxy: proxy.host,
            kCFNetworkProxiesHTTPPort: proxy.port,
        ]
        #if os(macOS)
        proxyDict[kCFNetworkProxiesHTTPSEnable] = true
        proxyDict[kCFNetworkProxiesHTTPSProxy] = proxy.host
        proxyDict[kCFNetworkProxiesHTTPSPort] = proxy.port
        #endif
        config.connectionProxyDictionary = proxyDict
        return URLSession(configuration: config)
    }
}
