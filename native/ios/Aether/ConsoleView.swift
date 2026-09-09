import SwiftUI
import UIKit
import WebKit

struct ConsoleView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        let raw = Bundle.main.object(forInfoDictionaryKey: "AETHER_APP_URL") as? String
        let fallback = "https://aether-global-uap-tracker.vercel.app"
        let url = URL(string: raw?.isEmpty == false ? raw! : fallback) ?? URL(string: fallback)!
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
