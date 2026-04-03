"use client";

import { useEffect, useState, useRef, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Send, Users } from "lucide-react";

const MESSAGES_PER_PAGE = 50;
const MESSAGE_BUFFER = 100; // Keep this many messages loaded at most
const CONSECUTIVE_MESSAGE_THRESHOLD = 3 * 60 * 1000; // 3 minutes in milliseconds
const TIME_DISPLAY_THRESHOLD = 2 * 60 * 1000; // 2 minutes in milliseconds

type PaginationState = {
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  oldestLoadedAt?: string;
  newestLoadedAt?: string;
};

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
  const [pagination, setPagination] = useState<PaginationState>({
    hasMoreOlder: true,
    hasMoreNewer: false,
  });
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const isNearBottomRef = useRef(true);
  const loadedRangeRef = useRef({ start: 0, end: 0 });
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
        .select("*, profiles(username, display_name)")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE);

      const orderedMessages = messagesData?.reverse() || [];
      setMessages(orderedMessages);
      setPagination({
        hasMoreOlder: (messagesData?.length || 0) >= MESSAGES_PER_PAGE,
        hasMoreNewer: false,
        oldestLoadedAt: orderedMessages[0]?.created_at,
        newestLoadedAt: orderedMessages[orderedMessages.length - 1]?.created_at,
      });
      setLoading(false);
    };

    fetchChatData();

    // Polling fallback - only poll for new messages
    const pollInterval = setInterval(async () => {
      if (!pagination.newestLoadedAt) return;

      const { data: messagesData } = await supabase
        .from("messages")
        .select("*, profiles(username, display_name)")
        .eq("chat_id", chatId)
        .gt("created_at", pagination.newestLoadedAt)
        .order("created_at", { ascending: true });

      if (messagesData && messagesData.length > 0) {
        setMessages((prev) => {
          const currentIds = new Set(prev.map((m) => m.id));
          const currentKeys = new Set(prev.map((m) => m.client_key).filter(Boolean));
          
          const newMessages = (messagesData as Message[]).filter((m) => {
            if (currentIds.has(m.id)) return false;
            if (m.client_key && currentKeys.has(m.client_key)) return false;
            return true;
          });
          
          if (newMessages.length === 0) return prev;
          
          const updated = [...prev, ...newMessages];
          // Trim if exceeds buffer while not viewing older messages
          if (updated.length > MESSAGE_BUFFER && isNearBottomRef.current) {
            const trimmed = updated.slice(updated.length - MESSAGE_BUFFER);
            setPagination(p => ({
              ...p,
              hasMoreOlder: true,
              oldestLoadedAt: trimmed[0]?.created_at,
            }));
            return trimmed;
          }
          
          setPagination(p => ({
            ...p,
            newestLoadedAt: newMessages[newMessages.length - 1]?.created_at,
          }));
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

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!loading && messages.length > 0 && isNearBottomRef.current) {
      messagesContainerRef.current?.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "auto",
      });
    }
  }, [loading, messages.length]);

  const loadOlderMessages = async () => {
    if (!pagination.oldestLoadedAt || isLoadingOlder || !pagination.hasMoreOlder) return;
    
    setIsLoadingOlder(true);
    const container = messagesContainerRef.current;
    const oldScrollHeight = container?.scrollHeight || 0;
    const oldScrollTop = container?.scrollTop || 0;

    const { data: olderMessages } = await supabase
      .from("messages")
      .select("*, profiles(username, display_name)")
      .eq("chat_id", chatId)
      .lt("created_at", pagination.oldestLoadedAt)
      .order("created_at", { ascending: false })
      .limit(MESSAGES_PER_PAGE);

    if (olderMessages && olderMessages.length > 0) {
      const ordered = olderMessages.reverse();
      setMessages((prev) => {
        const combined = [...ordered, ...prev];
        // Trim from bottom if we exceed buffer and were near bottom
        if (combined.length > MESSAGE_BUFFER && isNearBottomRef.current) {
          const trimmed = combined.slice(0, MESSAGE_BUFFER);
          setPagination(p => ({
            ...p,
            hasMoreOlder: olderMessages.length >= MESSAGES_PER_PAGE,
            hasMoreNewer: true,
            oldestLoadedAt: trimmed[0]?.created_at,
            newestLoadedAt: trimmed[trimmed.length - 1]?.created_at,
          }));
          return trimmed;
        }
        setPagination(p => ({
          ...p,
          hasMoreOlder: olderMessages.length >= MESSAGES_PER_PAGE,
          hasMoreNewer: true,
          oldestLoadedAt: ordered[0]?.created_at,
        }));
        return combined;
      });

      // Restore scroll position after older messages load
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          const heightAdded = newScrollHeight - oldScrollHeight;
          container.scrollTop = oldScrollTop + heightAdded;
        }
      });
    } else {
      setPagination(p => ({ ...p, hasMoreOlder: false }));
    }
    setIsLoadingOlder(false);
  };

  const unloadOlderMessages = () => {
    if (messages.length <= MESSAGE_BUFFER) return;
    
    const keepCount = Math.floor(MESSAGE_BUFFER * 0.7); // Keep 70% of buffer
    const toUnload = messages.length - keepCount;
    
    if (toUnload > 0) {
      const trimmed = messages.slice(toUnload);
      setMessages(trimmed);
      setPagination(p => ({
        ...p,
        hasMoreOlder: true,
        oldestLoadedAt: trimmed[0]?.created_at,
      }));
    }
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearTop = scrollTop < 100;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    
    isNearBottomRef.current = isNearBottom;
    scrollPositionRef.current = scrollTop;

    if (isNearTop && pagination.hasMoreOlder && !isLoadingOlder) {
      loadOlderMessages();
    }
    
    // Unload older messages when scrolling far down and have many loaded
    if (isNearBottom && messages.length > MESSAGE_BUFFER * 1.2) {
      unloadOlderMessages();
    }
  };

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
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-0">
        <div className="shrink-0 bg-card/95 backdrop-blur-sm border-x border-t border-border z-50">
          <div className="p-4 border-b border-border flex items-center gap-4">
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

          <div 
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {isLoadingOlder && (
              <div className="flex justify-center py-2">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!isLoadingOlder && pagination.hasMoreOlder && messages.length > 0 && (
              <div className="flex justify-center py-2 text-xs text-muted">
                Scroll up to load more
              </div>
            )}
            {messages.length === 0 ? (
              <div className="text-center text-muted py-12">
                <div className="w-16 h-16 bg-border rounded-full flex items-center justify-center mx-auto mb-4">
                  <Send className="w-6 h-6 opacity-40" />
                </div>
                <p>No messages yet. Say hello!</p>
              </div>
            ) : (
              messages.map((message, index) => {
                const isMe = message.sender_id === userId;
                const prevMessage = index > 0 ? messages[index - 1] : null;
                const shouldShowProfile = !isMe && (
                  !prevMessage || 
                  prevMessage.sender_id !== message.sender_id ||
                  new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime() > CONSECUTIVE_MESSAGE_THRESHOLD
                );
                
                const shouldShowTime = !prevMessage || 
                  prevMessage.sender_id !== message.sender_id ||
                  new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime() > TIME_DISPLAY_THRESHOLD;
                
                if (isMe) {
                  return (
                    <div
                      key={message.id}
                      className="flex justify-end"
                    >
                      <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-accent text-white rounded-br-md">
                        <div className="leading-relaxed">{message.content}</div>
                        {shouldShowTime && (
                          <div className="text-xs mt-1 text-white/60">
                            {formatTime(message.created_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                
                return (
                  <div
                    key={message.id}
                    className="flex justify-start"
                  >
                    <div className="flex gap-3 max-w-[80%]">
                      {shouldShowProfile && (
                        <div className="w-8 h-8 bg-border rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-foreground">
                            {(message.profiles.display_name || message.profiles.username).charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      {!shouldShowProfile && <div className="w-8 flex-shrink-0" />}
                      
                      <div className="flex-1 min-w-0">
                        {shouldShowProfile && (
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-sm font-medium text-foreground">
                              {message.profiles.display_name || `@${message.profiles.username}`}
                            </div>
                            {shouldShowTime && (
                              <div className="text-xs text-muted ml-2">
                                {formatTime(message.created_at)}
                              </div>
                            )}
                          </div>
                        )}
                        {!shouldShowProfile && shouldShowTime && (
                          <div className="text-xs text-muted mb-1">
                            {formatTime(message.created_at)}
                          </div>
                        )}
                        <div className="bg-border text-foreground rounded-2xl rounded-bl-md px-4 py-2.5 leading-relaxed">
                          {message.content}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div />
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
