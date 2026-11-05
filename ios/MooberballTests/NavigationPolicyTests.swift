import XCTest
@testable import Mooberball

final class NavigationPolicyTests: XCTestCase {
    func testGameOriginValidation() {
        for url in ["https://mooberball.com/", "https://www.mooberball.com/profile", "https://mooberball.com:443/rivalries"] {
            XCTAssertTrue(NavigationPolicy.isGameURL(URL(string: url)!), url)
        }
        for url in ["http://mooberball.com/", "https://mooberball.com.attacker.example/", "https://attacker.example/?next=mooberball.com", "https://mooberball.com@attacker.example/", "https://mooberball.com:8443/", "javascript:alert(1)", "file:///etc/passwd"] {
            XCTAssertFalse(NavigationPolicy.isGameURL(URL(string: url)!), url)
        }
    }

    func testOnlySupportedExternalSchemes() {
        XCTAssertTrue(NavigationPolicy.mayOpenExternally(URL(string: "https://example.com")!))
        XCTAssertTrue(NavigationPolicy.mayOpenExternally(URL(string: "mailto:hello@example.com")!))
        XCTAssertFalse(NavigationPolicy.mayOpenExternally(URL(string: "javascript:alert(1)")!))
        XCTAssertFalse(NavigationPolicy.mayOpenExternally(URL(string: "file:///tmp/example")!))
    }
}
