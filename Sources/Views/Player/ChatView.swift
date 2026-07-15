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
                                        .foregroundColor(colorForLogin(message.commenter.login))
                                    
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
    
    // Hash based color generation for usernames
    private func colorForLogin(_ login: String) -> Color {
        let colors: [Color] = [.red, .blue, .green, .orange, .purple, .pink, .teal, .indigo]
        let hash = abs(login.hashValue)
        return colors[hash % colors.count]
    }
}
