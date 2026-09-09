import SwiftUI

@main
struct AetherApp: App {
    var body: some Scene {
        WindowGroup {
            ConsoleView()
                .preferredColorScheme(.dark)
                .ignoresSafeArea()
        }
    }
}
