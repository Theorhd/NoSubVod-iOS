import SwiftUI

struct ChatView: View {
    let messages: [ChatMessage]
    
    var body: some View {
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
