import Foundation

enum GameDestination: String, CaseIterable, Identifiable {
    case play, rivalries, stats, profile

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .play: return "sportscourt"
        case .rivalries: return "bolt.fill"
        case .stats: return "chart.bar"
        case .profile: return "person.crop.circle"
        }
    }
    var url: URL {
        let path = self == .play ? "/" : "/" + rawValue
        return URL(string: "https://mooberball.com" + path)!
    }
}

enum NavigationPolicy {
    static func isGameURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && ["mooberball.com", "www.mooberball.com"].contains(url.host?.lowercased() ?? "")
            && url.user == nil && url.password == nil
            && (url.port == nil || url.port == 443)
    }

    static func mayOpenExternally(_ url: URL) -> Bool {
        ["https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "")
    }
}
