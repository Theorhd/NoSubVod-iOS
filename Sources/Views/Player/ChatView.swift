import SwiftUI

struct ChatView: View {
    let messages: [ChatMessage]

    // Composer (chat live uniquement)
    var isLiveChat: Bool = false
    var canSend: Bool = false
    var sendError: String?
    var onSend: ((String) -> Void)?
    var onLogin: (() -> Void)?

    @State private var draft: String = ""
    @State private var displayedError: String?

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack {
                            Spacer(minLength: 0)

                            LazyVStack(alignment: .leading, spacing: 8) {
                                ForEach(messages) { message in
                                    HStack(alignment: .top, spacing: 8) {
                                        Text(message.commenter.displayName)
                                            .font(.subheadline)
                                            .bold()
                                            .foregroundColor(colorForLogin(message.commenter))

                                        Text(message.message.fragments.first?.text ?? "")
                                            .font(.subheadline)
                                            .foregroundColor(.primary)
                                    }
                                    .padding(.horizontal)
                                    .padding(.vertical, 2)
                                    .id(message.id)
                                }
                            }
                        }
                        .frame(minHeight: geometry.size.height, alignment: .bottom)
                    }
                    .onChange(of: messages.count) {
                        if let lastId = messages.last?.id {
                            withAnimation {
                                proxy.scrollTo(lastId, anchor: .bottom)
                            }
                        }
                    }
                }
            }

            if isLiveChat {
                composer
            }
        }
        .onChange(of: sendError) { _, newValue in
            displayedError = newValue
            if newValue != nil {
                // La bannière d'erreur s'efface après 5 s.
                Task {
                    try? await Task.sleep(for: .seconds(5))
                    displayedError = nil
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 0) {
            if let displayedError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                    Text(displayedError)
                        .font(.caption)
                    Spacer()
                }
                .foregroundColor(.orange)
                .padding(.horizontal)
                .padding(.vertical, 6)
                .background(Color(.systemBackground))
            }

            HStack(spacing: 8) {
                TextField(canSend ? "Message..." : "Connecte-toi pour chatter", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .disabled(!canSend)

                if canSend {
                    Button(action: send) {
                        Image(systemName: "paperplane.fill")
                            .font(.title3)
                            .foregroundColor(isSendable ? .purple : .gray)
                    }
                    .disabled(!isSendable)
                } else {
                    Button("Se connecter") {
                        onLogin?()
                    }
                    .font(.subheadline)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
        }
    }

    private var isSendable: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        let text = draft
        draft = ""
        onSend?(text)
    }

    private func colorForLogin(_ commenter: ChatCommenter) -> Color {
        if let hex = commenter.colorHex, !hex.isEmpty,
           let color = Color(hex: hex) {
            return color
        }
        let colors: [Color] = [.red, .blue, .green, .orange, .purple, .pink, .teal, .indigo]
        let hash = abs(commenter.login.hashValue)
        return colors[hash % colors.count]
    }
}


private extension Color {
    /// Parse une couleur HTML (#RGB ou #RRGGBB), retourne nil si invalide.
    init?(hex: String) {
        var h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let val = UInt64(h, radix: 16) else { return nil }
        self.init(
            red:   Double((val >> 16) & 0xFF) / 255,
            green: Double((val >>  8) & 0xFF) / 255,
            blue:  Double( val        & 0xFF) / 255
        )
    }
}
