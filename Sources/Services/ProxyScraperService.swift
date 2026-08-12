import Foundation
import TSPlayerKit

/// Auto-discovers a working proxy in an ad-free country by scraping the
/// free-proxy lists (spys.one) and validating the candidates end-to-end
/// (reachable + ad-free egress). Used by the `.external` ad-block mode when
/// no proxy URL is configured, or the configured one fails.
enum ProxyScraperService {

    /// Country pages scraped for candidates — the ad-free countries from the
    /// cdn-perfprod list, one page each.
    static let countryPages: [String: String] = [
        "MD": "https://spys.one/free-proxy-list/MD/",
        "RU": "https://spys.one/free-proxy-list/RU/",
        "EE": "https://spys.one/free-proxy-list/EE/",
        "BG": "https://spys.one/free-proxy-list/BG/",
    ]

    /// spys.one serves its list to browsers; other UAs get a degraded page.
    private static let browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    private static let ipv4Pattern = regex(#"\b(\d{1,3}(?:\.\d{1,3}){3})\b"#)
    private static let scriptPattern = regex(#"<script[^>]*>(.*?)</script>"#, options: [.dotMatchesLineSeparators])
    private static let literalPattern = regex(#"["']([^"']*)["']"#)
    private static let xorGroupPattern = regex(#"\((\w+)\^(\w+)\)"#)
    private static let assignmentPattern = regex(#"(\w+)\s*=\s*(\w+)(?:\^(\w+))?;"#)
    private static let wordPattern = regex(#"\w+"#)
    /// The packer call that defines the port-XOR variables: two quoted args —
    /// the packed source and the split-by-`^` dictionary.
    private static let packerCallPattern = regex(#"'([^']*)',\d+,\d+,'([^']*)'\.split"#)

    /// Compile un pattern regex littéral (constante de compilation). Un pattern
    /// invalide est une erreur de programmation — signalée une fois avec le
    /// pattern fautif plutôt qu'un `try!` muet.
    private static func regex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern, options: options)
        } catch {
            preconditionFailure("Invalid regex pattern '\(pattern)': \(error)")
        }
    }

    /// Fetches every country page and parses the proxies, deduped across
    /// pages by host:port. A dead page is skipped, not fatal.
    ///
    /// Pages fetched CONCURRENTLY with a hard 12 s deadline: on a degraded
    /// network, a slow page must not block the live launch (the old sequential
    /// loop could take up to ~40 s of 10 s timeouts).
    static func fetchCandidates(session: URLSession? = nil) async -> [HTTPProxy] {
        let urlSession = session ?? makeScrapeSession()
        return await withTaskGroup(of: [HTTPProxy].self) { group in
            for page in countryPages.values {
                group.addTask {
                    await Self.fetchPage(page, session: urlSession)
                }
            }
            var proxies: [HTTPProxy] = []
            var seen = Set<String>()
            let deadline = Date().addingTimeInterval(12)
            while let batch = await group.next(), Date() < deadline {
                for proxy in batch {
                    let key = "\(proxy.host):\(proxy.port)"
                    if !seen.contains(key) {
                        seen.insert(key)
                        proxies.append(proxy)
                    }
                }
            }
            group.cancelAll()
            return proxies
        }
    }

    /// Parses proxies from a single spys.one page. Returns [] on any failure.
    private static func fetchPage(_ page: String, session: URLSession) async -> [HTTPProxy] {
        guard let pageURL = URL(string: page) else { return [] }
        do {
            let (data, response) = try await session.data(from: pageURL)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let html = String(data: data, encoding: .utf8) else { return [] }
            return parseProxies(from: html)
        } catch {
            return []
        }
    }

    /// Validates candidates CONCURRENTLY and returns the first valid one in
    /// pool order. Free lists are mostly dead (and the survivors are slow —
    /// several seconds to answer), so the wall time is set by the slowest
    /// attempt (~`timeout`), not by the attempt count: probing 24 dead
    /// proxies in parallel costs the same as probing one. `maxAttempts` caps
    /// the concurrent load.
    static func findFirstValid(_ candidates: [HTTPProxy], maxAttempts: Int = 24, session: URLSession? = nil) async -> HTTPProxy? {
        let attempts = Array(candidates.prefix(maxAttempts))
        guard !attempts.isEmpty else { return nil }
        // Free proxies answer slowly — 12 s per attempt instead of the 8 s
        // used for user-owned proxies (Squid answers in ms).
        let validIndices = await withTaskGroup(of: (Int, Bool).self) { group in
            for (index, proxy) in attempts.enumerated() {
                group.addTask {
                    let status = await ExternalProxyService.validate(proxy, session: session, timeout: 12).status
                    return (index, Self.isOK(status))
                }
            }
            var valid: [Int] = []
            for await (index, ok) in group {
                if ok { valid.append(index) }
            }
            return valid
        }
        return validIndices.sorted().first.map { attempts[$0] }
    }

    private static func isOK(_ status: ExternalProxyService.ValidationStatus) -> Bool {
        if case .ok = status { return true }
        return false
    }

    /// Parses proxy entries from one spys.one page.
    ///
    /// Every row has the IP in the first cell with its port obfuscated
    /// (`document.write(":"+(Two0ZeroTwo^Three3One)+…)` — XOR of JS variables
    /// defined in a packed script) or plain (`IP:port`). Only HTTP/HTTPS
    /// proxies are returned (SOCKS cannot be routed through
    /// `connectionProxyDictionary`), deduped by host:port.
    static func parseProxies(from html: String) -> [HTTPProxy] {
        let variables = variableTable(from: html)
        var seen = Set<String>()
        var proxies: [HTTPProxy] = []
        for row in html.components(separatedBy: "<tr").dropFirst() {
            guard let ip = firstIPv4(in: row) else { continue }
            guard isHTTPRow(row) else { continue }
            let cell = cellAfter(ip, in: row)
            guard let port = portFromCell(cell, variables: variables) else { continue }
            let key = "\(ip):\(port)"
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            proxies.append(HTTPProxy(host: ip, port: port))
        }
        return proxies
    }

    /// Decodes the JS packer spys.one wraps its variable definitions in,
    /// returning the decoded assignments (`Six0Eight=3923^443;Zero=2;…`).
    /// The packer format has been stable for years; nil if it ever changes
    /// (XOR rows then parse as unknown and are dropped).
    static func decodePacker(from html: String) -> String? {
        let ns = html as NSString
        guard let match = packerCallPattern.firstMatch(in: html, range: NSRange(location: 0, length: ns.length)) else {
            return nil
        }
        let source = ns.substring(with: match.range(at: 1))
        let dict = ns.substring(with: match.range(at: 2)).components(separatedBy: "^")
        // Mirror the packer's word map: 0-9 and a-z are base36 of the index,
        // 36-59 are 'A'-'X' via String.fromCharCode(index + 29).
        var map: [String: String] = [:]
        for (index, entry) in dict.enumerated().reversed() {
            guard let key = packerKey(index) else { continue }
            map[key] = entry.isEmpty ? key : entry
        }
        let sourceNS = source as NSString
        var result = ""
        var cursor = 0
        for word in wordPattern.matches(in: source, range: NSRange(location: 0, length: sourceNS.length)) {
            result += sourceNS.substring(with: NSRange(location: cursor, length: word.range.location - cursor))
            let token = sourceNS.substring(with: word.range)
            result += map[token] ?? token
            cursor = word.range.location + word.range.length
        }
        result += sourceNS.substring(from: cursor)
        return result
    }

    /// Evaluates the decoded assignments into a name → value table. The
    /// packer emits them in dependency order — plain values first, then
    /// compounds referencing earlier names — so a single pass suffices.
    private static func variableTable(from html: String) -> [String: Int] {
        guard let decoded = decodePacker(from: html) else { return [:] }
        let ns = decoded as NSString
        var table: [String: Int] = [:]
        for match in assignmentPattern.matches(in: decoded, range: NSRange(location: 0, length: ns.length)) {
            let name = ns.substring(with: match.range(at: 1))
            guard let first = resolveOperand(ns.substring(with: match.range(at: 2)), in: table) else { continue }
            if match.range(at: 3).location == NSNotFound {
                table[name] = first
            } else if let second = resolveOperand(ns.substring(with: match.range(at: 3)), in: table) {
                table[name] = first ^ second
            }
        }
        return table
    }

    private static func resolveOperand(_ token: String, in table: [String: Int]) -> Int? {
        if let number = Int(token) { return number }
        return table[token]
    }

    /// Extracts the port from the cell content following the IP, in order:
    /// 1. XOR groups — each `(A^B)` evaluates to one port digit,
    /// 2. concatenated string literals (`document.write(":"+"3"+"1"+"2"+"8")`),
    /// 3. a plain `:port` right after the IP.
    private static func portFromCell(_ cell: String, variables: [String: Int]) -> Int? {
        // 1. Current spys.one format: (Var^Var) groups, each a digit.
        if !variables.isEmpty {
            let ns = cell as NSString
            var digits = ""
            var resolvable = true
            for match in xorGroupPattern.matches(in: cell, range: NSRange(location: 0, length: ns.length)) {
                guard let a = variables[ns.substring(with: match.range(at: 1))],
                      let b = variables[ns.substring(with: match.range(at: 2))] else {
                    resolvable = false
                    break
                }
                digits += String(a ^ b)
            }
            if resolvable, !digits.isEmpty, let port = Int(digits), (1...65535).contains(port) {
                return port
            }
        }
        // 2. Legacy format: the port spelled out in `document.write("…")`
        //    string-literal chunks.
        let ns = cell as NSString
        let scripts = scriptPattern.matches(in: cell, range: NSRange(location: 0, length: ns.length))
        var literals = ""
        for script in scripts {
            let body = ns.substring(with: script.range(at: 1))
            let bodyNS = body as NSString
            for literal in literalPattern.matches(in: body, range: NSRange(location: 0, length: bodyNS.length)) {
                literals += bodyNS.substring(with: literal.range(at: 1))
            }
        }
        if !literals.isEmpty {
            let digits = literals.filter(\.isNumber)
            if let port = Int(digits), (1...65535).contains(port) { return port }
        }
        // 3. Plain `IP:port` — strip any markup then expect a leading colon.
        let stripped = cell.replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if stripped.hasPrefix(":"),
           let port = Int(stripped.dropFirst().trimmingCharacters(in: .whitespaces)),
           (1...65535).contains(port) {
            return port
        }
        return nil
    }

    // MARK: - Row helpers

    private static func firstIPv4(in row: String) -> String? {
        let ns = row as NSString
        guard let match = ipv4Pattern.firstMatch(in: row, range: NSRange(location: 0, length: ns.length)) else {
            return nil
        }
        let ip = ns.substring(with: match.range(at: 1))
        return isValidIPv4(ip) ? ip : nil
    }

    /// The cell content right after the IP, up to the closing `</td>` —
    /// where the obfuscated port lives.
    private static func cellAfter(_ ip: String, in row: String) -> String {
        let ns = row as NSString
        let ipRange = ns.range(of: ip)
        let afterIP = ipRange.location + ipRange.length
        let cellEnd = ns.range(of: "</td>", options: [], range: NSRange(location: afterIP, length: ns.length - afterIP))
        let end = cellEnd.location == NSNotFound ? ns.length : cellEnd.location
        return ns.substring(with: NSRange(location: afterIP, length: end - afterIP))
    }

    /// The proxy type sits in the second cell ("HTTP", "HTTPS", "SOCKS5"…).
    /// Rows that support SOCKS are dropped: URLSession only routes HTTP/
    /// HTTPS through `connectionProxyDictionary`.
    private static func isHTTPRow(_ row: String) -> Bool {
        guard let firstCellEnd = row.range(of: "</td>") else { return true }
        let rest = row[firstCellEnd.upperBound...]
        guard let cellStart = rest.range(of: "<td"), let cellEnd = rest.range(of: "</td>", range: cellStart.lowerBound..<rest.endIndex) else {
            return true
        }
        let type = rest[cellStart.lowerBound..<cellEnd.lowerBound]
            .replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return !type.uppercased().contains("SOCKS")
    }

    private static func isValidIPv4(_ ip: String) -> Bool {
        let octets = ip.split(separator: ".")
        return octets.count == 4 && octets.allSatisfy { octet in
            guard let value = Int(octet), (0...255).contains(value) else { return false }
            return true
        }
    }

    /// Packer key for a dictionary index: 0-9 → "0"-"9", 10-35 → "a"-"z"
    /// (base36), 36-59 → "A"-"X" (String.fromCharCode(index + 29)).
    private static func packerKey(_ index: Int) -> String? {
        if index >= 36 {
            guard let scalar = UnicodeScalar(index + 29) else { return nil }
            return String(scalar)
        }
        if index < 10 {
            return String(index)
        }
        guard let scalar = UnicodeScalar(97 + index - 10) else { return nil }
        return String(scalar)
    }

    private static func makeScrapeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.httpAdditionalHeaders = [
            "User-Agent": browserUserAgent,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        ]
        return URLSession(configuration: config)
    }
}
