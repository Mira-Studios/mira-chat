"use client";

import { useEffect, useState, useRef, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, Users } from "lucide-react";

type SupabaseParticipant = {
  profiles: {
    id: string;
    username: string;
    display_name?: string;
  };
};

type SupabaseMessage = {
  id: string;
  chat_id: string;
  content: string;
  sender_id: string;
  created_at: string;
  client_key?: string;
};

type Message = {
  id: string;
  chat_id?: string;
  content: string;
  sender_id: string;
  created_at: string;
  client_key?: string;
  profiles: {
    username: string;
    display_name?: string;
  };
};

type Chat = {
  id: string;
  name: string | null;
};

type Participant = {
  id: string;
  username: string;
  display_name?: string;
};

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const fetchChatData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setUserId(user.id);

      const { data: chatData } = await supabase
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .single();

      if (!chatData) {
        router.push("/chats");
        return;
      }
      setChat(chatData);

      const { data: participantsData } = await supabase
        .from("chat_participants")
        .select("user_id, profiles(id, username, display_name)")
        .eq("chat_id", chatId);

      const mappedParticipants: Participant[] = participantsData?.map((p: unknown) => {
        const participant = p as SupabaseParticipant;
        return {
          id: participant.profiles.id,
          username: participant.profiles.username,
          display_name: participant.profiles.display_name,
        };
      }) || [];
      setParticipants(mappedParticipants);

      const isParticipant = mappedParticipants.some((p) => p.id === user.id);
      if (!isParticipant) {
        router.push("/chats");
        return;
      }

      const { data: messagesData } = await supabase
        .from("messages")
        .select("*, profiles(username)")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      setMessages(messagesData || []);
      setLoading(false);
    };

    fetchChatData();

    // Polling fallback since realtime isn't working
    const pollInterval = setInterval(async () => {
      const { data: messagesData } = await supabase
        .from("messages")
        .select("*, profiles(username, display_name)")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (messagesData) {
        setMessages((prev) => {
          const serverMsgs = messagesData as Message[];
          const currentIds = new Set(prev.map((m) => m.id));
          const currentKeys = new Set(prev.map((m) => m.client_key).filter(Boolean));
          
          // Add messages from server that aren't already in state
          // Skip ones that match our optimistic messages by client_key
          const newMessages = serverMsgs.filter((m) => {
            if (currentIds.has(m.id)) return false;
            // Skip if this is our message with a matching client_key
            if (m.client_key && currentKeys.has(m.client_key)) return false;
            return true;
          });
          
          // Replace optimistic messages with real ones by client_key
          const updated = prev.map((m) => {
            if (m.id.startsWith("temp-") && m.client_key) {
              const realMatch = serverMsgs.find(
                (s) => s.client_key === m.client_key
              );
              if (realMatch) {
                return { ...realMatch, profiles: { username: "You" } };
              }
            }
            return m;
          });
          
          if (newMessages.length > 0) {
            return [...updated, ...newMessages];
          }
          return updated;
        });
      }
    }, 2000);

    const subscription = supabase
      .channel(`chat:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          console.log("Realtime message received:", payload);
          const msg = payload.new as SupabaseMessage;
          if (msg.chat_id !== chatId) return;
          
          const { data: profileData } = await supabase
            .from("profiles")
            .select("username, display_name")
            .eq("id", msg.sender_id)
            .single();

          const newMsg: Message = {
            ...msg,
            profiles: { 
              username: profileData?.username || "Unknown",
              display_name: profileData?.display_name 
            },
          };

          setMessages((prev) => {
            // If this is our message with a matching client_key, replace the optimistic one
            if (msg.client_key) {
              const hasOptimistic = prev.some(
                (m) => m.client_key === msg.client_key && m.id.startsWith("temp-")
              );
              if (hasOptimistic) {
                return prev.map((m) =>
                  m.client_key === msg.client_key
                    ? { ...newMsg, profiles: { username: "You" } }
                    : m
                );
              }
            }
            // Otherwise just add it (from other users)
            return [...prev, newMsg];
          });
        }
      )
      .subscribe((status) => {
        console.log("Realtime subscription status:", status);
      });

    return () => {
      clearInterval(pollInterval);
      subscription.unsubscribe();
    };
  }, [chatId, supabase, router]);

  // Scroll to bottom on initial load and when messages change
  useEffect(() => {
    if (!loading && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [loading, messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !userId) return;

    const content = newMessage.trim();
    setNewMessage("");

    // Optimistically add message to UI
    const clientKey = `ck-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      chat_id: chatId,
      content,
      sender_id: userId,
      created_at: new Date().toISOString(),
      client_key: clientKey,
      profiles: { username: "You" },
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const { error } = await supabase.from("messages").insert({
      chat_id: chatId,
      sender_id: userId,
      content,
      client_key: clientKey,
    });

    if (error) {
      console.error("Error sending message:", error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
  };

  const formatTime = (date: string) => {
    return new Date(date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const otherParticipants = participants.filter((p) => p.id !== userId);
  const chatTitle = chat?.name || otherParticipants.map((p) => p.display_name || `@${p.username}`).join(", ") || "Chat";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col">
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-x border-t border-border z-50">
          <div className="p-4 border-b border-border flex items-center gap-4">
            <Link
              href="/chats"
              className="text-muted hover:text-foreground transition-colors p-1 hover:bg-border rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold text-foreground truncate">{chatTitle}</h1>
              <div className="flex items-center gap-1 text-sm text-muted">
                <Users className="w-3.5 h-3.5" />
                <span>{otherParticipants.length + 1} participant{otherParticipants.length !== 0 ? "s" : ""}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-card border-x border-border flex-1 flex flex-col overflow-hidden">

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center text-muted py-12">
                <div className="w-16 h-16 bg-border rounded-full flex items-center justify-center mx-auto mb-4">
                  <Send className="w-6 h-6 opacity-40" />
                </div>
                <p>No messages yet. Say hello!</p>
              </div>
            ) : (
              messages.map((message) => {
                const isMe = message.sender_id === userId;
                return (
                  <div
                    key={message.id}
                    className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        isMe
                          ? "bg-accent text-white rounded-br-md"
                          : "bg-border text-foreground rounded-bl-md"
                      }`}
                    >
                      {!isMe && (
                        <div className="text-xs font-medium text-accent mb-1">
                          {message.profiles.display_name || `@${message.profiles.username}`}
                        </div>
                      )}
                      <div className="leading-relaxed">{message.content}</div>
                      <div
                        className={`text-xs mt-1 ${
                          isMe ? "text-white/60" : "text-muted"
                        }`}
                      >
                        {formatTime(message.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-x border-b border-border z-50">
          <form onSubmit={sendMessage} className="flex gap-3 p-4">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="px-4 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
