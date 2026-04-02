use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::VecDeque;
use std::time::Duration;
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::message::ServerMessage;
use twitch_irc::{ClientConfig, SecureTCPTransport, TwitchIRCClient};

const CHAT_BUFFER_CAPACITY: usize = 220;
const CHAT_FLUSH_INTERVAL_MS: u64 = 150;
const CHAT_FLUSH_THRESHOLD: usize = 90;
const CHAT_DROP_ON_PRESSURE: usize = 30;
const CHAT_MAX_BATCH_SIZE: usize = 140;

#[derive(Serialize)]
struct ChatBadge {
    name: String,
    version: String,
}

#[derive(Serialize)]
struct ChatEmote {
    id: String,
    #[serde(rename = "startIndex")]
    start_index: usize,
    #[serde(rename = "endIndex")]
    end_index: usize,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ChatEvent {
    Msg {
        id: String,
        sender: String,
        #[serde(rename = "displayName")]
        display_name: String,
        color: Option<String>,
        message: String,
        badges: Vec<ChatBadge>,
        emotes: Vec<ChatEmote>,
        timestamp: i64,
    },
    ClearChat,
    ClearMsg {
        id: String,
    },
}

#[derive(Serialize)]
struct ChatBatch {
    #[serde(rename = "type")]
    kind: &'static str,
    messages: Vec<ChatEvent>,
}

pub async fn handle_chat_ws(ws: WebSocketUpgrade, Path(login): Path<String>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, login))
}

async fn handle_socket(socket: WebSocket, login: String) {
    let config = ClientConfig::default();
    let (mut incoming_messages, client) =
        TwitchIRCClient::<SecureTCPTransport, StaticLoginCredentials>::new(config);

    if let Err(e) = client.join(login.clone()) {
        eprintln!("[Chat] Failed to join channel: {}", e);
        return;
    }

    eprintln!("[Chat] Connected to channel chat: {}", login);

    let (mut sender, mut receiver) = socket.split();

    // Task to handle incoming WebSocket messages (mostly heartbeats or close)
    let mut ws_read_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(Message::Close(_)) = msg {
                break;
            }
        }
    });

    // Task to handle Twitch messages with batching and a Ring Buffer
    let mut twitch_read_task = tokio::spawn(async move {
        // Ring buffer to hold processed messages before they are batched/flushed.
        // Reusing the same allocation to avoid repeated memory allocations.
        let mut ring_buffer: VecDeque<ChatEvent> = VecDeque::with_capacity(CHAT_BUFFER_CAPACITY);

        // Interval for batching messages (e.g., every 150ms)
        let mut flush_interval =
            tokio::time::interval(Duration::from_millis(CHAT_FLUSH_INTERVAL_MS));
        // Avoid immediate tick
        flush_interval.tick().await;

        loop {
            tokio::select! {
                // Receive message from Twitch
                Some(message) = incoming_messages.recv() => {
                    match message {
                        ServerMessage::Privmsg(msg) => {
                            let color_str = msg
                                .name_color
                                .map(|c| format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b));

                            let mut badges = Vec::with_capacity(msg.badges.len());
                            for b in msg.badges {
                                badges.push(ChatBadge {
                                    name: b.name,
                                    version: b.version,
                                });
                            }

                            let mut emotes = Vec::with_capacity(msg.emotes.len());
                            for e in msg.emotes {
                                emotes.push(ChatEmote {
                                    id: e.id,
                                    start_index: e.char_range.start,
                                    end_index: e.char_range.end,
                                });
                            }

                            let out = ChatEvent::Msg {
                                id: msg.message_id,
                                sender: msg.sender.login,
                                display_name: msg.sender.name,
                                color: color_str,
                                message: msg.message_text,
                                badges,
                                emotes,
                                timestamp: msg.server_timestamp.timestamp_millis(),
                            };

                            if ring_buffer.len() >= ring_buffer.capacity() {
                                // Slow websocket or burst: keep recent messages, drop oldest.
                                for _ in 0..CHAT_DROP_ON_PRESSURE {
                                    if ring_buffer.pop_front().is_none() {
                                        break;
                                    }
                                }
                            }
                            ring_buffer.push_back(out);
                        }
                        ServerMessage::ClearChat(_msg) => {
                            ring_buffer.push_back(ChatEvent::ClearChat);
                        }
                        ServerMessage::ClearMsg(msg) => {
                            ring_buffer.push_back(ChatEvent::ClearMsg { id: msg.message_id });
                        }
                        _ => {}
                    }

                    // If we have a lot of messages, flush immediately without waiting for the timer
                    if ring_buffer.len() >= CHAT_FLUSH_THRESHOLD
                        && flush_messages(&mut sender, &mut ring_buffer).await.is_err()
                    {
                        break;
                    }
                }
                // Periodic flush
                _ = flush_interval.tick() => {
                    if !ring_buffer.is_empty()
                        && flush_messages(&mut sender, &mut ring_buffer).await.is_err()
                    {
                        break;
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = &mut ws_read_task => {
            eprintln!("[Chat] WebSocket closed for {}", login);
            twitch_read_task.abort();
        },
        _ = &mut twitch_read_task => {
            eprintln!("[Chat] Twitch reader task finished for {}", login);
            ws_read_task.abort();
        },
    }

    eprintln!("[Chat] Disconnected from channel: {}", login);
}

/// Helper to flush messages from the ring buffer to the WebSocket as a batch.
async fn flush_messages(
    sender: &mut futures::stream::SplitSink<WebSocket, Message>,
    buffer: &mut VecDeque<ChatEvent>,
) -> Result<(), ()> {
    if buffer.is_empty() {
        return Ok(());
    }

    // We send a batch to reduce the number of messages sent over the WebSocket.
    let batch = ChatBatch {
        kind: "batch",
        messages: buffer
            .drain(..CHAT_MAX_BATCH_SIZE.min(buffer.len()))
            .collect(),
    };

    if let Ok(json_str) = serde_json::to_string(&batch) {
        if sender.send(Message::Text(json_str)).await.is_err() {
            return Err(());
        }
    }

    Ok(())
}
