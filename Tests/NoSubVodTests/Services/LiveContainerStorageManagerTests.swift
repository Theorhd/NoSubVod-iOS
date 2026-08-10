import XCTest
@testable import NoSubVod

final class LiveContainerStorageManagerTests: XCTestCase {

    let testSuiteName = "com.theorhd.NoSubVodTests.LiveContainer"
    var testDefaults: UserDefaults!
    var tempDir: URL!
    var manager: LiveContainerStorageManager!

    override func setUp() {
        super.setUp()
        testDefaults = UserDefaults(suiteName: testSuiteName)
        testDefaults.removePersistentDomain(forName: testSuiteName)

        tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("LiveContainerTest-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)


    }

    override func tearDown() {
        testDefaults.removePersistentDomain(forName: testSuiteName)
        try? FileManager.default.removeItem(at: tempDir)
        super.tearDown()
    }


    func testLiveContainerPrefs_encodeDecode_roundTrip() throws {
        var prefs = LiveContainerPrefs()
        prefs.defaultVideoQuality = "1080p"
        prefs.isDebugModeEnabled = true
        prefs.isLiveContainerStorageEnabled = true
        prefs.twitch_access_token = "test-token"

        let data = try JSONEncoder().encode(prefs)
        let decoded = try JSONDecoder().decode(LiveContainerPrefs.self, from: data)

        XCTAssertEqual(decoded.defaultVideoQuality, "1080p")
        XCTAssertEqual(decoded.isDebugModeEnabled, true)
        XCTAssertEqual(decoded.isLiveContainerStorageEnabled, true)
        XCTAssertEqual(decoded.twitch_access_token, "test-token")
    }

    func testLiveContainerPrefs_partialData() throws {
        var prefs = LiveContainerPrefs()
        prefs.isLiveContainerStorageEnabled = true


        let data = try JSONEncoder().encode(prefs)
        let decoded = try JSONDecoder().decode(LiveContainerPrefs.self, from: data)

        XCTAssertTrue(decoded.isLiveContainerStorageEnabled == true)
        XCTAssertNil(decoded.defaultVideoQuality)
        XCTAssertNil(decoded.twitch_access_token)
    }

    func testLiveContainerPrefs_emptyPrefs() throws {
        let prefs = LiveContainerPrefs()

        let data = try JSONEncoder().encode(prefs)
        let decoded = try JSONDecoder().decode(LiveContainerPrefs.self, from: data)

        XCTAssertNil(decoded.defaultVideoQuality)
        XCTAssertNil(decoded.isDebugModeEnabled)
        XCTAssertNil(decoded.isLiveContainerStorageEnabled)
        XCTAssertNil(decoded.twitch_access_token)
    }


    func testPreferencesFile_readWriteRoundTrip() throws {
        var prefs = LiveContainerPrefs()
        prefs.defaultVideoQuality = "720p"
        prefs.isLiveContainerStorageEnabled = true
        prefs.twitch_access_token = "secret-token"

        let fileURL = tempDir.appendingPathComponent("LiveContainerPrefs.json")


        let writeData = try JSONEncoder().encode(prefs)
        try writeData.write(to: fileURL)


        let readData = try Data(contentsOf: fileURL)
        let decoded = try JSONDecoder().decode(LiveContainerPrefs.self, from: readData)

        XCTAssertEqual(decoded.defaultVideoQuality, "720p")
        XCTAssertTrue(decoded.isLiveContainerStorageEnabled == true)
        XCTAssertEqual(decoded.twitch_access_token, "secret-token")
    }

    func testPreferencesFile_corruptedJSON_throws() {
        let fileURL = tempDir.appendingPathComponent("CorruptedPrefs.json")
        try? "not valid json".data(using: .utf8)!.write(to: fileURL)

        XCTAssertThrowsError(try JSONDecoder().decode(LiveContainerPrefs.self, from: Data(contentsOf: fileURL)))
    }


    func testRestoreAndSave_cycle() throws {

        testDefaults.set(true, forKey: "isLiveContainerStorageEnabled")
        testDefaults.set("1080p", forKey: "defaultVideoQuality")
        testDefaults.set("test-access-token", forKey: "twitch_access_token")


        XCTAssertTrue(testDefaults.bool(forKey: "isLiveContainerStorageEnabled"))
        XCTAssertEqual(testDefaults.string(forKey: "defaultVideoQuality"), "1080p")
        XCTAssertEqual(testDefaults.string(forKey: "twitch_access_token"), "test-access-token")


        var prefs = LiveContainerPrefs()
        prefs.isLiveContainerStorageEnabled = testDefaults.bool(forKey: "isLiveContainerStorageEnabled")
        prefs.defaultVideoQuality = testDefaults.string(forKey: "defaultVideoQuality")
        prefs.twitch_access_token = testDefaults.string(forKey: "twitch_access_token")


        let fileURL = tempDir.appendingPathComponent("LiveContainerPrefs.json")
        let data = try JSONEncoder().encode(prefs)
        try data.write(to: fileURL)


        let restoredData = try Data(contentsOf: fileURL)
        let restored = try JSONDecoder().decode(LiveContainerPrefs.self, from: restoredData)

        let restoredDefaults = UserDefaults(suiteName: "\(testSuiteName)-restored")!
        restoredDefaults.removePersistentDomain(forName: "\(testSuiteName)-restored")
        defer { restoredDefaults.removePersistentDomain(forName: "\(testSuiteName)-restored") }

        if restored.isLiveContainerStorageEnabled == true {
            if let quality = restored.defaultVideoQuality {
                restoredDefaults.set(quality, forKey: "defaultVideoQuality")
            }
            if let token = restored.twitch_access_token {
                restoredDefaults.set(token, forKey: "twitch_access_token")
            }
            restoredDefaults.set(true, forKey: "isLiveContainerStorageEnabled")
        }

        XCTAssertTrue(restoredDefaults.bool(forKey: "isLiveContainerStorageEnabled"))
        XCTAssertEqual(restoredDefaults.string(forKey: "defaultVideoQuality"), "1080p")
        XCTAssertEqual(restoredDefaults.string(forKey: "twitch_access_token"), "test-access-token")
    }
}
