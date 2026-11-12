import SwiftUI

@MainActor
struct GameView: View {
    @StateObject private var browser = GameBrowser()
    @State private var showAbout = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let failure = browser.failure {
                    VStack(spacing: 12) {
                        Text(failure).multilineTextAlignment(.center)
                        Button("Try again") { browser.retry() }
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.thinMaterial)
                }
                GameWebView(browser: browser)
                HStack {
                    ForEach(GameDestination.allCases) { destination in
                        Button {
                            browser.navigate(to: destination)
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: destination.symbol)
                                Text(destination.title).font(.caption)
                            }
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.bar)
            }
            .navigationTitle("Mooberball")
            .navigationBarTitleDisplayMode(.inline)
            .tint(.yellow)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back", systemImage: "chevron.left") { browser.webView.goBack() }
                        .disabled(!browser.canGoBack)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Reload", systemImage: "arrow.clockwise") { browser.retry() }
                    Button("About", systemImage: "info.circle") { showAbout = true }
                }
            }
            .alert("Open another app?", isPresented: Binding(
                get: { browser.externalURL != nil },
                set: { if !$0 { browser.externalURL = nil } }
            )) {
                Button("Open") {
                    if let url = browser.externalURL { openURL(url) }
                    browser.externalURL = nil
                }
                Button("Cancel", role: .cancel) { browser.externalURL = nil }
            } message: {
                Text(browser.externalURL?.host ?? "This link opens outside Mooberball.")
            }
            .sheet(isPresented: $showAbout) {
                NavigationStack {
                    Form {
                        Section("Mooberball") {
                            Text("Your weekly fantasy radio game.")
                            Text("iPhone preview · 0.1.0").foregroundStyle(.secondary)
                        }
                        Section {
                            Text("Mooberball is a stupid, fun fan-made game. Not affiliated with or endorsed by the show or station at all. Happy Birthday, Bob.")
                        }
                    }
                    .navigationTitle("About")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showAbout = false }
                        }
                    }
                }
            }
        }
    }

}
