"use client";

import { useEffect, useState, useRef, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Send, Users, Settings, X, Plus, UserMinus, UserPlus } from "lucide-react";

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
    avatar_url?: string;
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
    avatar_url?: string;
  };
};

type Chat = {
  id: string;
  name: string | null;
  picture_url?: string;
};

type Participant = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
};

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [messageLayout, setMessageLayout] = useState<"default" | "left">(() => {
    const savedLayout = typeof window !== 'undefined' ? localStorage.getItem("messageLayout") as "default" | "left" : "default";
    return (savedLayout === "default" || savedLayout === "left") ? savedLayout : "default";
  });
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupPicture, setEditGroupPicture] = useState("");
  const [uploadingGroupPfp, setUploadingGroupPfp] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<Profile[]>([]);
  const [selectedNewMembers, setSelectedNewMembers] = useState<Profile[]>([]);
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

  // Listen for localStorage changes
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "messageLayout") {
        const newLayout = e.newValue as "default" | "left";
        if (newLayout === "default" || newLayout === "left") {
          setMessageLayout(newLayout);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Also check for direct changes (same tab)
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const currentLayout = localStorage.getItem("messageLayout") as "default" | "left";
      if (currentLayout !== messageLayout && (currentLayout === "default" || currentLayout === "left")) {
        setMessageLayout(currentLayout);
      }
    }, 500);

    return () => clearInterval(checkInterval);
  }, [messageLayout]);

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setMemberSearchResults([]);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
      .limit(10);

    if (error) {
      console.error("Error searching users:", error);
      return;
    }

    // Filter out existing participants
    const existingIds = new Set(participants.map(p => p.id));
    const filteredResults = (data as Profile[]).filter(p => !existingIds.has(p.id));
    
    setMemberSearchResults(filteredResults);
  };

  // Search users when query changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchUsers(memberSearchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [memberSearchQuery, participants, searchUsers]);

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
        .select("user_id, profiles(id, username, display_name, avatar_url)")
        .eq("chat_id", chatId);

      const mappedParticipants: Participant[] = participantsData?.map((p: unknown) => {
        const participant = p as SupabaseParticipant;
        return {
          id: participant.profiles.id,
          username: participant.profiles.username,
          display_name: participant.profiles.display_name,
          avatar_url: participant.profiles.avatar_url,
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
        .select("*, profiles(username, display_name, avatar_url)")
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
        .select("*, profiles(username, display_name, avatar_url)")
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
            .select("username, display_name, avatar_url")
            .eq("id", msg.sender_id)
            .single();

          const newMsg: Message = {
            ...msg,
            profiles: { 
              username: profileData?.username || "Unknown",
              display_name: profileData?.display_name,
              avatar_url: profileData?.avatar_url 
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
      .select("*, profiles(username, display_name, avatar_url)")
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

  const handleEditGroup = () => {
    setEditGroupName(chat?.name || "");
    setEditGroupPicture(chat?.picture_url || "");
    setEditingGroup(true);
  };

  const handleGroupPictureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB');
      return;
    }

    setUploadingGroupPfp(true);

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        setEditGroupPicture(e.target?.result as string);
        setUploadingGroupPfp(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading image:', error);
      setUploadingGroupPfp(false);
    }
  };

  const saveGroupSettings = async () => {
    if (!chat) return;
    
    const { error } = await supabase
      .from("chats")
      .update({
        name: editGroupName || null,
        picture_url: editGroupPicture || null,
      })
      .eq("id", chat.id);

    if (error) {
      console.error("Error updating group:", error);
      return;
    }

    setChat({
      ...chat,
      name: editGroupName || null,
      picture_url: editGroupPicture || undefined,
    });
    setEditingGroup(false);
  };

  const addMembers = async () => {
    if (selectedNewMembers.length === 0 || !chat) return;

    const { error } = await supabase
      .from("chat_participants")
      .insert(
        selectedNewMembers.map(member => ({
          chat_id: chat.id,
          user_id: member.id,
        }))
      );

    if (error) {
      console.error("Error adding members:", error);
      return;
    }

    // Update local state
    setParticipants(prev => [...prev, ...selectedNewMembers]);
    setSelectedNewMembers([]);
    setMemberSearchQuery("");
    setMemberSearchResults([]);
  };

  const removeMember = async (memberId: string) => {
    if (!chat) return;

    const { error } = await supabase
      .from("chat_participants")
      .delete()
      .eq("chat_id", chat.id)
      .eq("user_id", memberId);

    if (error) {
      console.error("Error removing member:", error);
      return;
    }

    // Update local state
    setParticipants(prev => prev.filter(p => p.id !== memberId));
  };

  const otherParticipants = participants.filter((p) => p.id !== userId);
  const myProfile = participants.find((p) => p.id === userId);
  const chatTitle = chat?.name || otherParticipants.map((p) => p.display_name || `@${p.username}`).join(", ") || "Chat";
  const isGroupChat = participants.length > 2;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex flex-col w-full min-h-0">
        <div className="shrink-0 bg-card/95 backdrop-blur-sm border-t border-border z-50">
          <div className="p-4 border-b border-border flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold text-foreground truncate">{chatTitle}</h1>
              <div className="flex items-center gap-1 text-sm text-muted">
                <Users className="w-3.5 h-3.5" />
                <span>{otherParticipants.length + 1} participant{otherParticipants.length !== 0 ? "s" : ""}</span>
              </div>
            </div>
            {isGroupChat && (
              <button
                onClick={() => setShowGroupSettings(true)}
                className="p-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                title="Group Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="bg-card flex-1 flex flex-col overflow-hidden">

          <div 
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4"
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
                
                const shouldShowMyProfile = isMe && messageLayout === "left" && (
                  !prevMessage || 
                  prevMessage.sender_id !== message.sender_id ||
                  new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime() > CONSECUTIVE_MESSAGE_THRESHOLD
                );
                
                const shouldShowTime = !prevMessage || 
                  prevMessage.sender_id !== message.sender_id ||
                  new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime() > TIME_DISPLAY_THRESHOLD;
                
                const isDifferentSender = !prevMessage || prevMessage.sender_id !== message.sender_id;
                
                if (isMe) {
                  const shouldAlignLeft = messageLayout === "left";
                  if (shouldAlignLeft) {
                    // Left-aligned layout with profile picture
                    return (
                      <div
                        key={message.id}
                        className={`flex justify-start px-4 rounded-lg hover:bg-accent/5 transition-colors group ${
                          isDifferentSender ? "pt-2 pb-0.5" : "py-0.5"
                        }`}
                      >
                        <div className="flex gap-3 max-w-[80%]">
                          {shouldShowMyProfile && (
                            <>
                              {myProfile?.avatar_url ? (
                                <img 
                                  src={myProfile.avatar_url} 
                                  alt="Profile" 
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-medium text-white">
                                    {(myProfile?.display_name || myProfile?.username || "You").charAt(0).toUpperCase()}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                          {!shouldShowMyProfile && <div className="w-8 flex-shrink-0" />}
                          
                          <div className="flex-1 min-w-0">
                            {shouldShowMyProfile && (
                            <div className="mb-1">
                              <div className="flex items-center gap-3">
                                <div className="text-sm font-medium text-foreground min-w-0 flex-shrink-0">
                                  {myProfile?.display_name || `@${myProfile?.username}` || "You"}
                                </div>
                                <div className="text-xs text-muted flex-shrink-0">
                                  {formatTime(message.created_at)}
                                </div>
                              </div>
                            </div>
                          )}
                          {!shouldShowMyProfile && shouldShowTime && (
                            <div className="mb-1">
                              <div className="flex items-center gap-3">
                                <div className="text-sm font-medium text-foreground min-w-0 flex-shrink-0">
                                  {myProfile?.display_name || `@${myProfile?.username}` || "You"}
                                </div>
                                <div className="text-xs text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {formatTime(message.created_at)}
                                </div>
                              </div>
                            </div>
                          )}
                            <div className="leading-relaxed text-foreground">
                              {message.content}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    // Default right-aligned layout
                    return (
                      <div
                        key={message.id}
                        className={`flex justify-end px-4 rounded-lg hover:bg-accent/5 transition-colors group ${
                          isDifferentSender ? "pt-2 pb-0.5" : "py-0.5"
                        }`}
                      >
                        <div className="max-w-[80%] text-right">
                          {shouldShowTime && (
                            <div className="flex items-center justify-end mb-1">
                              <div className="text-xs text-muted mr-2">
                                {formatTime(message.created_at)}
                              </div>
                              <div className="text-sm font-medium text-foreground">
                                {myProfile?.display_name || `@${myProfile?.username}` || "You"}
                              </div>
                            </div>
                          )}
                          <div className="leading-relaxed text-foreground">{message.content}</div>
                        </div>
                      </div>
                    );
                  }
                }
                
                return (
                  <div
                    key={message.id}
                    className={`flex justify-start px-4 rounded-lg hover:bg-accent/5 transition-colors group ${
                      isDifferentSender ? "pt-2 pb-0.5" : "py-0.5"
                    }`}
                  >
                    <div className="flex gap-3 max-w-[80%]">
                      {shouldShowProfile && (
                            <>
                              {message.profiles.avatar_url ? (
                                <img 
                                  src={message.profiles.avatar_url} 
                                  alt="Profile" 
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 bg-border rounded-full flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-medium text-foreground">
                                    {(message.profiles.display_name || message.profiles.username).charAt(0).toUpperCase()}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                          {!shouldShowProfile && <div className="w-8 flex-shrink-0" />}
                      
                      <div className="flex-1 min-w-0">
                        {shouldShowProfile && (
                            <div className="mb-1">
                              <div className="flex items-center gap-3">
                                <div className="text-sm font-medium text-foreground min-w-0 flex-shrink-0">
                                  {message.profiles.display_name || `@${message.profiles.username}`}
                                </div>
                                <div className="text-xs text-muted flex-shrink-0">
                                  {formatTime(message.created_at)}
                                </div>
                              </div>
                            </div>
                        )}
                        {!shouldShowProfile && shouldShowTime && (
                          <div className="mb-1">
                            <div className="flex items-center gap-3">
                              <div className="text-sm font-medium text-foreground min-w-0 flex-shrink-0">
                                {message.profiles.display_name || `@${message.profiles.username}`}
                              </div>
                              <div className="text-xs text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                {formatTime(message.created_at)}
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="leading-relaxed text-foreground">
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

        <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-b border-border z-50">
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

      {/* Group Settings Modal */}
      {showGroupSettings && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowGroupSettings(false)}
        >
          <div 
            className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold text-foreground">Group Settings</h2>
              <button
                onClick={() => setShowGroupSettings(false)}
                className="text-muted hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Group Info Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Group Info</h3>
                  {!editingGroup && (
                    <button
                      onClick={handleEditGroup}
                      className="text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
                
                {!editingGroup ? (
                  <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
                    {chat?.picture_url ? (
                      <img 
                        src={chat.picture_url} 
                        alt="Group" 
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-accent rounded-full flex items-center justify-center">
                        <span className="text-lg font-medium text-white">
                          {(chat?.name || "Group").charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="font-medium text-foreground">
                        {chat?.name || "Unnamed Group"}
                      </div>
                      <div className="text-sm text-muted">
                        {participants.length} members
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
                      <div className="relative">
                        {editGroupPicture ? (
                          <img 
                            src={editGroupPicture} 
                            alt="Group" 
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-accent rounded-full flex items-center justify-center">
                            <span className="text-lg font-medium text-white">
                              {(editGroupName || "Group").charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <label className="absolute -bottom-1 -right-1 w-6 h-6 bg-accent hover:bg-accent-hover rounded-full flex items-center justify-center cursor-pointer transition-colors">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleGroupPictureUpload}
                            className="hidden"
                            disabled={uploadingGroupPfp}
                          />
                          {uploadingGroupPfp ? (
                            <div className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <Plus className="w-3 h-3 text-white" />
                          )}
                        </label>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">
                          {editGroupName || "Unnamed Group"}
                        </div>
                        <div className="text-sm text-muted">
                          {participants.length} members
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Group Name
                      </label>
                      <input
                        type="text"
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        className="w-full px-3 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                        placeholder="Group name"
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={saveGroupSettings}
                        className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingGroup(false)}
                        className="flex-1 py-2.5 bg-background border border-border hover:bg-card-hover text-foreground font-medium rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Members Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Members ({participants.length})</h3>
                  <button
                    onClick={() => setManagingMembers(!managingMembers)}
                    className="text-xs text-accent hover:text-accent-hover transition-colors"
                  >
                    {managingMembers ? "Done" : "Manage"}
                  </button>
                </div>
                
                {managingMembers && (
                  <div className="space-y-3">
                    {/* Add Members Section */}
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Add Members
                      </label>
                      <input
                        type="text"
                        value={memberSearchQuery}
                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                        placeholder="Search users..."
                      />
                      
                      {memberSearchResults.length > 0 && (
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {memberSearchResults.map((user) => (
                            <div
                              key={user.id}
                              onClick={() => {
                                if (!selectedNewMembers.find(u => u.id === user.id)) {
                                  setSelectedNewMembers(prev => [...prev, user]);
                                }
                              }}
                              className="flex items-center gap-2 p-2 bg-background border border-border rounded-lg cursor-pointer hover:bg-card-hover transition-colors"
                            >
                              {user.avatar_url ? (
                                <img 
                                  src={user.avatar_url} 
                                  alt="Profile" 
                                  className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-6 h-6 bg-border rounded-full flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-medium text-foreground">
                                    {(user.display_name || user.username || "?").charAt(0).toUpperCase()}
                                  </span>
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-foreground truncate">
                                  {user.display_name || `@${user.username}`}
                                </div>
                                <div className="text-xs text-muted truncate">
                                  @{user.username}
                                </div>
                              </div>
                              <UserPlus className="w-4 h-4 text-muted" />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {selectedNewMembers.length > 0 && (
                        <div className="flex gap-2">
                          <button
                            onClick={addMembers}
                            className="flex-1 py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors text-sm"
                          >
                            Add {selectedNewMembers.length} member{selectedNewMembers.length !== 1 ? "s" : ""}
                          </button>
                          <button
                            onClick={() => setSelectedNewMembers([])}
                            className="px-3 py-2 bg-background border border-border hover:bg-card-hover text-foreground font-medium rounded-lg transition-colors text-sm"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className={`space-y-2 ${managingMembers ? "max-h-48" : "max-h-64"} overflow-y-auto`}>
                  {participants.map((participant) => (
                    <div key={participant.id} className="flex items-center gap-3 p-2 bg-background border border-border rounded-lg">
                      {participant.avatar_url ? (
                        <img 
                          src={participant.avatar_url} 
                          alt="Profile" 
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-border rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-foreground">
                            {(participant.display_name || participant.username || "?").charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {participant.display_name || `@${participant.username}`}
                          {participant.id === userId && " (You)"}
                        </div>
                        <div className="text-xs text-muted truncate">
                          @{participant.username}
                        </div>
                      </div>
                      {managingMembers && participant.id !== userId && (
                        <button
                          onClick={() => removeMember(participant.id)}
                          className="p-1 text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Remove member"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
