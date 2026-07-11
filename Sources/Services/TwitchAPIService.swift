import Foundation

enum TwitchAPIError: Error {
    case invalidURL
    case invalidResponse
    case decodingError(Error)
    case requestFailed(Error)
    case unauthorized
}

class TwitchAPIService {
    static let shared = TwitchAPIService()
    
    private let helixBaseURL = "https://api.twitch.tv/helix"
    private let gqlBaseURL = "https://gql.twitch.tv/gql"
    
    var accessToken: String?
    var clientId: String = "kimne78kx3ncx6brgo4mv6wki5h1ko" // Twitch default web client ID often used for GQL if no auth
    
    private init() {}
    
    // MARK: - Helix API
    
    func fetchUser(login: String) async throws -> TwitchUser {
        guard let url = URL(string: "\(helixBaseURL)/users?login=\(login)") else {
            throw TwitchAPIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let token = accessToken {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue(clientId, forHTTPHeaderField: "Client-Id")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw TwitchAPIError.invalidResponse
        }
        
        // This is a simplified decoding for now
        let decoder = JSONDecoder()
        struct UserResponse: Codable {
            let data: [TwitchUser]
        }
        
        do {
            let result = try decoder.decode(UserResponse.self, from: data)
            guard let user = result.data.first else {
                throw TwitchAPIError.invalidResponse
            }
            return user
        } catch {
            throw TwitchAPIError.decodingError(error)
        }
    }
    
    // MARK: - GQL API
    
    func executeGQLQuery(query: String, variables: [String: Any]) async throws -> Data {
        guard let url = URL(string: gqlBaseURL) else {
            print("GQL ERROR: invalidURL")
            throw TwitchAPIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let token = accessToken {
            request.addValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue("kimne78kx3ncx6brgo4mv6wki5h1ko", forHTTPHeaderField: "Client-Id")
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "query": query,
            "variables": variables
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            print("GQL ERROR: Not HTTPURLResponse")
            throw TwitchAPIError.invalidResponse
        }
        
        if httpResponse.statusCode != 200 {
            print("GQL ERROR: statusCode = \(httpResponse.statusCode), body = \(String(data: data, encoding: .utf8) ?? "")")
            throw TwitchAPIError.invalidResponse
        }
        
        return data
    }
}
