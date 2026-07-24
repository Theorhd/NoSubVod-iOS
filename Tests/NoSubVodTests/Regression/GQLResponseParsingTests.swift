import XCTest
@testable import NoSubVod

final class GQLResponseParsingTests: XCTestCase {


    func testParseDate_withFractionalSeconds() {
        let result = TwitchAPIService.shared.parseDate("2024-06-15T14:30:00.000Z")
        XCTAssertNotNil(result)
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let components = utcCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: result)
        XCTAssertEqual(components.year, 2024)
        XCTAssertEqual(components.month, 6)
        XCTAssertEqual(components.day, 15)
        XCTAssertEqual(components.hour, 14)
        XCTAssertEqual(components.minute, 30)
    }

    func testParseDate_withoutFractionalSeconds() {
        let result = TwitchAPIService.shared.parseDate("2024-01-15T10:30:00Z")
        XCTAssertNotNil(result)
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let components = utcCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: result)
        XCTAssertEqual(components.year, 2024)
        XCTAssertEqual(components.month, 1)
        XCTAssertEqual(components.day, 15)
        XCTAssertEqual(components.hour, 10)
        XCTAssertEqual(components.minute, 30)
    }

    func testParseDate_nilReturnsNow() {
        let before = Date()
        let result = TwitchAPIService.shared.parseDate(nil)
        let after = Date()
        XCTAssertGreaterThanOrEqual(result, before)
        XCTAssertLessThanOrEqual(result, after)
    }

    func testParseDate_invalidString_returnsNow() {
        let before = Date()
        let result = TwitchAPIService.shared.parseDate("not-a-date")
        let after = Date()
        XCTAssertGreaterThanOrEqual(result, before)
        XCTAssertLessThanOrEqual(result, after)
    }


    func testDecodeLiveStreams_fromFixture() throws {
        let json = loadFixture("gql_live_streams")

        struct GQLResponse: Codable {
            struct Data: Codable {
                struct Streams: Codable {
                    struct Edge: Codable {
                        struct Node: Codable {
                            let id: String
                            let title: String?
                            let viewersCount: Int?
                            let previewImageURL: String?
                            let createdAt: String?
                            let language: String?
                            struct Game: Codable { let id: String; let name: String; let boxArtURL: String? }
                            struct Broadcaster: Codable { let id: String; let login: String; let displayName: String; let profileImageURL: String? }
                            let game: Game?
                            let broadcaster: Broadcaster?
                        }
                        let node: Node?
                    }
                    let edges: [Edge]?
                }
                let streams: Streams?
            }
            let data: Data?
        }

        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        let edges = response.data?.streams?.edges ?? []
        XCTAssertEqual(edges.count, 2)

        let first = edges[0].node!
        XCTAssertEqual(first.id, "42080878076")
        XCTAssertEqual(first.viewersCount, 25120)
        XCTAssertEqual(first.broadcaster?.login, "kaicenat")
        XCTAssertEqual(first.game?.name, "Just Chatting")

        let second = edges[1].node!
        XCTAssertEqual(second.language, "fr")
        XCTAssertEqual(second.broadcaster?.displayName, "ZeratoR")
        XCTAssertEqual(second.game?.name, "Fortnite")
    }


    func testDecodeChannelVODs_fromFixture() throws {
        let json = loadFixture("gql_channel_vods")

        struct GQLResponse: Codable {
            struct Data: Codable {
                struct User: Codable {
                    struct Videos: Codable {
                        struct Edge: Codable {
                            struct Node: Codable {
                                let id: String; let title: String?; let lengthSeconds: Int?
                                let previewThumbnailURL: String?; let createdAt: String?
                                let viewCount: Int?; let broadcastType: String?
                                struct Game: Codable { let id: String; let name: String; let boxArtURL: String? }
                                struct Owner: Codable { let id: String; let login: String; let displayName: String; let profileImageURL: String? }
                                let game: Game?; let owner: Owner?
                            }
                            let node: Node?
                        }
                        let edges: [Edge]?
                    }
                    let videos: Videos?
                }
                let user: User?
            }
            let data: Data?
        }

        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        let edges = response.data?.user?.videos?.edges ?? []
        XCTAssertEqual(edges.count, 2)

        let firstNode = edges[0].node!
        XCTAssertEqual(firstNode.id, "2170531517")
        XCTAssertEqual(firstNode.broadcastType, "HIGHLIGHT")
        XCTAssertEqual(firstNode.lengthSeconds, 12360)
        XCTAssertEqual(firstNode.viewCount, 1542000)

        let secondNode = edges[1].node!
        XCTAssertEqual(secondNode.broadcastType, "ARCHIVE")
        XCTAssertEqual(secondNode.owner?.login, "kaicenat")
    }


    func testDecodeSearch_fromFixture() throws {
        let json = loadFixture("gql_search")

        struct GQLResponse: Codable {
            struct Data: Codable {
                struct Game: Codable {
                    let id: String?; let name: String?; let boxArtURL: String?
                }
                struct SearchFor: Codable {
                    struct Channels: Codable {
                        struct Edge: Codable {
                            struct Item: Codable {
                                let id: String?; let login: String?; let displayName: String?
                                let profileImageURL: String?
                                struct Stream: Codable {
                                    let id: String; let title: String?; let viewersCount: Int?
                                    let previewImageURL: String?; let createdAt: String?; let language: String?
                                }
                                let stream: Stream?
                            }
                            let item: Item?
                        }
                        let edges: [Edge]?
                    }
                    let channels: Channels?
                }
                let game: Game?
                let searchFor: SearchFor?
            }
            let data: Data?
        }

        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        XCTAssertEqual(response.data?.game?.name, "Just Chatting")
        let channels = response.data?.searchFor?.channels?.edges ?? []
        XCTAssertEqual(channels.count, 1)
        XCTAssertEqual(channels[0].item?.login, "zerator")
        XCTAssertEqual(channels[0].item?.stream?.language, "fr")
    }


    func testDecodeCategoryDetails_fromFixture() throws {
        let json = loadFixture("gql_category_details")

        struct GQLResponse: Codable {
            struct Data: Codable {
                struct Game: Codable {
                    struct Streams: Codable {
                        struct Edge: Codable {
                            struct Node: Codable {
                                let id: String; let title: String?; let viewersCount: Int?
                                let previewImageURL: String?; let createdAt: String?; let language: String?
                                struct Broadcaster: Codable { let id: String; let login: String; let displayName: String; let profileImageURL: String? }
                                let broadcaster: Broadcaster?
                            }
                            let node: Node?
                        }
                        let edges: [Edge]?
                    }
                    struct Videos: Codable {
                        struct Edge: Codable {
                            struct Node: Codable {
                                let id: String; let title: String?; let lengthSeconds: Int?
                                let previewThumbnailURL: String?; let createdAt: String?
                                let viewCount: Int?; let broadcastType: String?
                                struct Owner: Codable { let id: String; let login: String; let displayName: String; let profileImageURL: String? }
                                struct Game: Codable { let id: String; let name: String; let boxArtURL: String? }
                                let owner: Owner?; let game: Game?
                            }
                            let node: Node?
                        }
                        let edges: [Edge]?
                    }
                    struct Clips: Codable {
                        struct Edge: Codable {
                            struct Node: Codable {
                                let id: String; let title: String?; let durationSeconds: Int?
                                let thumbnailURL: String?; let createdAt: String?; let viewCount: Int?
                                struct Broadcaster: Codable { let id: String; let login: String; let displayName: String; let profileImageURL: String? }
                                struct Game: Codable { let id: String; let name: String; let boxArtURL: String? }
                                let broadcaster: Broadcaster?; let game: Game?
                            }
                            let node: Node?
                        }
                        let edges: [Edge]?
                    }
                    let streams: Streams?; let videos: Videos?; let clips: Clips?
                }
                let game: Game?
            }
            let data: Data?
        }

        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        XCTAssertNotNil(response.data?.game)
        XCTAssertEqual(response.data?.game?.streams?.edges?.count, 1)
        XCTAssertEqual(response.data?.game?.videos?.edges?.count, 1)
        XCTAssertEqual(response.data?.game?.clips?.edges?.count, 1)

        let clip = response.data?.game?.clips?.edges?[0].node
        XCTAssertEqual(clip?.durationSeconds, 30)
        XCTAssertEqual(clip?.viewCount, 50000)
    }


    func testDecodeVODChat_fromFixture() throws {
        let json = loadFixture("gql_vod_chat")

        let jsonObj = try JSONSerialization.jsonObject(with: json) as! [String: Any]
        let dataDict = jsonObj["data"] as! [String: Any]
        let videoDict = dataDict["video"] as! [String: Any]
        let commentsDict = videoDict["comments"] as! [String: Any]
        let edges = commentsDict["edges"] as! [[String: Any]]

        XCTAssertEqual(edges.count, 2)

        let firstNode = edges[0]["node"] as! [String: Any]
        XCTAssertEqual(firstNode["id"] as? String, "comment-001")
        XCTAssertEqual(firstNode["contentOffsetSeconds"] as? Int, 120)

        let commenter = firstNode["commenter"] as! [String: Any]
        XCTAssertEqual(commenter["login"] as? String, "viewer1")
        XCTAssertEqual(commenter["displayName"] as? String, "ViewerOne")

        let message = firstNode["message"] as! [String: Any]
        let fragments = message["fragments"] as! [[String: Any]]
        XCTAssertEqual(fragments.count, 1)
        XCTAssertEqual(fragments[0]["text"] as? String, "LOL that was amazing")
    }


    private func loadFixture(_ name: String) -> Data {
        let bundle = Bundle(for: type(of: self))
        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
              let data = try? Data(contentsOf: url) else {
            let fixturePath = URL(fileURLWithPath: #file)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Fixtures")
                .appendingPathComponent("\(name).json")
            return (try? Data(contentsOf: fixturePath)) ?? Data()
        }
        return data
    }
}
