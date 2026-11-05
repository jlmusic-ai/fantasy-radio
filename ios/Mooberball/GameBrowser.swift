import SwiftUI
import WebKit

// One web view keeps cookies and in-progress game state together.
// The app never reads credentials, cookies, tokens, or game-page JavaScript.
@MainActor
final class GameBrowser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    @Published var loading = false
    @Published var failure: String?
    @Published var canGoBack = false
    @Published var externalURL: URL?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        // Back gestures could discard an unsaved lineup. Use the confirmed Back button.
        webView.allowsBackForwardNavigationGestures = false
        webView.load(URLRequest(url: GameDestination.play.url))
    }

    func navigate(to destination: GameDestination) {
        failure = nil
        webView.load(URLRequest(url: destination.url))
    }

    func retry() {
        failure = nil
        if webView.url == nil {
            navigate(to: .play)
        } else {
            webView.reload()
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        failure = nil
        loading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        canGoBack = webView.canGoBack
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    private func handle(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        loading = false
        canGoBack = webView.canGoBack
        failure = "Mooberball couldn't load. Check your connection, then try again."
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loading = false
        failure = "Mooberball needs to reload. Unsaved picks may need to be entered again."
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Captcha and other embedded resources stay governed by the website.
        if action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        guard let url = action.request.url else {
            decisionHandler(.cancel)
            return
        }
        if NavigationPolicy.isGameURL(url) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        loading = false
        if action.navigationType == .linkActivated && NavigationPolicy.mayOpenExternally(url) {
            externalURL = url
        } else {
            // Do not forward OAuth URLs into Safari: its cookies don't authenticate this web view.
            failure = "This sign-in or destination isn't supported in this preview. Use your Mooberball email and password."
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, NavigationPolicy.isGameURL(url) {
            webView.load(action.request)
        }
        return nil
    }
}

struct GameWebView: UIViewRepresentable {
    let browser: GameBrowser

    func makeUIView(context: Context) -> WKWebView { browser.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
