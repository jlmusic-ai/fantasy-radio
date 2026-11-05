# Mooberball for iPhone — first development milestone

This is a SwiftUI iPhone prototype using one persistent WKWebView to play the existing production game. Accounts, picks, rankings and rivalries remain in the existing website/backend. No privileged keys, new database or production web changes are needed.

This milestone is **not App Store submission ready**. It establishes the iOS target and the device-testing path. It adds native navigation, a loading indicator, retry messaging, confirmed navigation to protect unsaved picks, an offline About screen and explicit confirmation before opening external links. It does not add push notifications or offline gameplay.

## Open on a Mac

1. Install the current stable Xcode from the Mac App Store and open it once to install its components.
2. With Homebrew installed, run `brew install xcodegen`.
3. Check out this branch and run `cd ios`, then `xcodegen generate`.
4. Open `Mooberball.xcodeproj`. Select the Mooberball target → Signing & Capabilities → your existing Apple Developer team. Automatic signing is enabled. The proposed bundle ID is `com.mooberball.ios`; verify availability under your team before registering it or creating an App Store Connect app.
5. Select an iPhone simulator and Run. For a physical iPhone, connect it, enable Developer Mode when prompted, select it as the destination and Run.
6. Run Product → Test for navigation-policy unit tests.

Generated Xcode projects are ignored; update project.yml for durable project settings. No team ID, certificate or Apple account password belongs in this repository.

## Device acceptance checks

- Email/password login completes with Turnstile; cookies survive relaunch.
- Sign-up, confirmation and password recovery work. Email links currently open the website; universal links and cross-context recovery need implementation before release.
- Existing and new players can save valid picks, reload and see saved values. Test cancelled navigation with an unsaved lineup.
- Lock time, submitted status, weekly/season rankings and Rivalries match the website.
- Profile upload works with the photo picker and camera, including denied permissions.
- Log out prevents further protected access; sign back in as a different test user.
- Test airplane mode, retry, slow connections, process termination, keyboard, large text and VoiceOver.
- External links ask before opening; automatic off-origin navigation is blocked. Facebook OAuth is not supported by this prototype. The website's feature flag may expose that button; test email/password only until native social authentication is implemented.

The app reaches live Mooberball data: use designated test accounts and do not modify real players' picks during testing. A Mac/iOS build and device QA have not yet been performed in the Linux development environment.

## Before TestFlight / App Store

- Produce and verify a successful signed device archive with current Apple-required SDKs.
- Add production app icon, launch assets and screenshots.
- Make the mobile navigation/layout feel integrated; the web header remains visible in this prototype.
- Deliver meaningful app-specific functionality and polish beyond the web wrapper (Apple guideline 4.2). Native tabs alone do not establish review eligibility.
- Implement/test notification opt-in, device-token lifecycle and server-side eligibility filtering before offering pick reminders. Never notify players who have already submitted.
- Implement secure in-app account deletion, including associated data/storage and session handling. The current profile page has no self-service deletion.
- Review Facebook-login availability. If offered in the iOS release, implement an equivalent privacy-preserving login option satisfying guideline 4.8, normally Sign in with Apple, and account linking.
- Publish a privacy policy and support contact; audit data collection for App Privacy disclosures, privacy manifests and age rating. Assess user-content/reporting needs for public usernames and photos.
- Verify rights to any third-party branding/content used in the app and store listing; do not imply show/station endorsement.
- Establish universal links for email confirmation/recovery without allowing arbitrary URLs or logging tokens.
- Prepare reviewer access to active game functionality, review notes and a demo account.
- Add the App Store Connect record only after bundle ID/team are confirmed. Archive → Distribute App → App Store Connect → Upload; first validate through TestFlight.

References: [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/), [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [XcodeGen](https://github.com/yonaskolb/XcodeGen).
