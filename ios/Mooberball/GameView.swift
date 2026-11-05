import SwiftUI

@MainActor
struct GameView: View {
    @StateObject private var browser = GameBrowser()
    @State private var pendingAction: PendingAction?
    @State private var showAbout = false
    @Environment(\.openURL) private var openURL

    private enum PendingAction: Identifiable {
        case destination(GameDestination), back, reload
        var id: String {
            switch self {
            case .destination(let destination): return destination.rawValue
            case .back: return "back"
            case .reload: return "reload"
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if browser.loading {
                    ProgressView("Loading Mooberball…")
                        .padding(8)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                if let failure = browser.failure {
                    VStack(spacing: 12) {
                        Text(failure).multilineTextAlignment(.center)
                        Button("Try again") { pendingAction = .reload }
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.thinMaterial)
                }
                GameWebView(browser: browser)
                HStack {
                    ForEach(GameDestination.allCases) { destination in
                        Button {
                            pendingAction = .destination(destination)
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
                    Button("Back", systemImage: "chevron.left") { pendingAction = .back }
                        .disabled(!browser.canGoBack)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Reload", systemImage: "arrow.clockwise") { pendingAction = .reload }
                    Button("About", systemImage: "info.circle") { showAbout = true }
                }
            }
            .confirmationDialog("Leave this page?", isPresented: Binding(
                get: { pendingAction != nil },
                set: { if !$0 { pendingAction = nil } }
            ), presenting: pendingAction) { action in
                Button("Continue") { perform(action) }
                Button("Stay here", role: .cancel) {}
            } message: { _ in
                Text("Save any lineup changes before continuing. Unsaved changes may be lost.")
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

    private func perform(_ action: PendingAction) {
        switch action {
        case .destination(let destination): browser.navigate(to: destination)
        case .back: browser.webView.goBack()
        case .reload: browser.retry()
        }
        pendingAction = nil
    }
}
