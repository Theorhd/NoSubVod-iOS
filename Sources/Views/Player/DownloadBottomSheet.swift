import SwiftUI

struct DownloadBottomSheet: View {
    @Binding var isPresented: Bool
    @Binding var isSegmentSelectionMode: Bool
    let onDownloadFull: (String) -> Void
    let onDownloadSegment: (String) -> Void
    
    // For success state
    var isSuccessMode: Bool = false
    
    @State private var fullDownloadLoading = false
    @State private var fullDownloadSuccess = false
    
    @State private var selectedQuality: String = "chunked"
    
    let qualities = [
        ("Source", "chunked"),
        ("1080p60", "1080p60"),
        ("720p60", "720p60"),
        ("480p30", "480p30"),
        ("360p30", "360p30"),
        ("160p30", "160p30"),
        ("Audio Only", "audio_only")
    ]
    
    var body: some View {
        VStack(spacing: 24) {
            if isSuccessMode {
                VStack(spacing: 16) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 64))
                        .foregroundColor(.green)
                    Text("Segment selected successfully!")
                        .font(.headline)
                }
                .padding(.vertical, 40)
            } else {
                Text("Download Options")
                    .font(.title2)
                    .bold()
                    .padding(.top, 16)
                
                VStack(spacing: 16) {
                    HStack {
                        Text("Quality")
                            .font(.headline)
                        Spacer()
                        Picker("Quality", selection: $selectedQuality) {
                            ForEach(qualities, id: \.1) { quality in
                                Text(quality.0).tag(quality.1)
                            }
                        }
                        .pickerStyle(MenuPickerStyle())
                        .tint(.purple)
                    }
                    .padding(.horizontal)
                    
                    Button(action: {
                        fullDownloadLoading = true
                        // Simulate loading animation before action
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                            fullDownloadLoading = false
                            fullDownloadSuccess = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                                onDownloadFull(selectedQuality)
                                isPresented = false
                            }
                        }
                    }) {
                        HStack {
                            if fullDownloadLoading {
                                ProgressView()
                                    .tint(.white)
                                    .padding(.trailing, 8)
                            } else if fullDownloadSuccess {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.white)
                                    .padding(.trailing, 8)
                            } else {
                                Image(systemName: "arrow.down.to.line")
                                    .padding(.trailing, 8)
                            }
                            
                            Text("Download Full VOD")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(fullDownloadSuccess ? Color.green : Color.purple)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(fullDownloadLoading || fullDownloadSuccess)
                    
                    Button(action: {
                        onDownloadSegment(selectedQuality)
                        isPresented = false
                    }) {
                        HStack {
                            Image(systemName: "scissors")
                                .padding(.trailing, 8)
                            Text("Download Segment")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(.systemGray5))
                        .foregroundColor(.primary)
                        .cornerRadius(12)
                    }
                }
                .padding(.horizontal)
                
                Spacer()
            }
        }
        .padding()
        .presentationDetents([.height(250)])
        .presentationDragIndicator(.visible)
    }
}
