"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Plus, ChevronRight, LogOut, X, Settings, ArrowLeft } from "lucide-react";
import { cache, CACHE_KEYS, CACHE_TTL } from "@/lib/cache";
import { ChatListSkeleton, ProfileSkeleton, SearchSkeleton } from "@/components/skeletons";
import { UnreadDot } from "@/components/unread-indicator";

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

type Profile = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
};

type Chat = {
  id: string;
  name: string | null;
  participants: Profile[];
  last_message_at?: string;
  updated_at?: string;
};

export default function ChatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [unreadChats, setUnreadChats] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [messageLayout, setMessageLayout] = useState<"default" | "left">(() => {
    const savedLayout = typeof window !== 'undefined' ? localStorage.getItem("messageLayout") as "default" | "left" : "default";
    return (savedLayout === "default" || savedLayout === "left") ? savedLayout : "default";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editProfilePicture, setEditProfilePicture] = useState("");
  const [uploadingPfp, setUploadingPfp] = useState(false);
  const isMobile = useIsMobile();
  const pathname = usePathname();

  // On mobile, show sidebar only on /chats, show chat on /chats/[id]
  const isChatListView = pathname === "/chats";
  const showSidebar = !isMobile || isChatListView;
  const showMainContent = !isMobile || !isChatListView;

  // Save message layout preference to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("messageLayout", messageLayout);
  }, [messageLayout]);
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [chatName, setChatName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const params = useParams();
  const currentChatId = params?.id as string | undefined;
  const supabase = createClient();
  const router = useRouter();

  // Track recently accessed chats (within 2 days)
  const isRecentlyAccessed = useCallback((chatId: string) => {
    const recentAccess = cache.get<Record<string, number>>(CACHE_KEYS.RECENT_CHAT_ACCESS) || {};
    const lastAccess = recentAccess[chatId];
    if (!lastAccess) return false;
    
    const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
    return lastAccess > twoDaysAgo;
  }, []);

  // Mark chat as accessed
  const markChatAccessed = useCallback((chatId: string) => {
    const recentAccess = cache.get<Record<string, number>>(CACHE_KEYS.RECENT_CHAT_ACCESS) || {};
    recentAccess[chatId] = Date.now();
    cache.set(CACHE_KEYS.RECENT_CHAT_ACCESS, recentAccess, CACHE_TTL.RECENT_CHAT_ACCESS);
  }, []);

  // Update unread status when current chat changes
  useEffect(() => {
    if (currentChatId) {
      // Mark current chat as read and accessed
      markChatAccessed(currentChatId);
      
      const timer = setTimeout(() => {
        setUnreadChats(prev => {
          const newSet = new Set(prev);
          newSet.delete(currentChatId);
          return newSet;
        });
        
        // Update last read time in cache
        cache.set(CACHE_KEYS.LAST_READ_MESSAGES(currentChatId), Date.now(), CACHE_TTL.LAST_READ_MESSAGES);
      }, 0);
      
      return () => clearTimeout(timer);
    }
  }, [currentChatId, markChatAccessed]);

  // Check for unread messages
  const checkUnreadMessages = useCallback((chatId: string, lastMessageTime?: string) => {
    if (!lastMessageTime || !user) return false;
    
    const lastReadTime = cache.get<number>(CACHE_KEYS.LAST_READ_MESSAGES(chatId));
    if (!lastReadTime) {
      // If no last read time, check if this is a new chat (created after user joined)
      return true; // Show as unread until user opens it
    }
    
    const messageTime = new Date(lastMessageTime).getTime();
    return messageTime > lastReadTime;
  }, [user]);

  // Update unread status when chats or user changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (chats.length > 0 && user) {
        const newUnreadChats = new Set<string>();
        
        chats.forEach(chat => {
          const isUnread = chat.id !== currentChatId && checkUnreadMessages(chat.id, chat.last_message_at);
          console.log(`Chat ${chat.id} unread:`, isUnread, 'last_message_at:', chat.last_message_at);
          if (isUnread) {
            newUnreadChats.add(chat.id);
          }
        });
        
        console.log('Setting unread chats:', newUnreadChats);
        setUnreadChats(newUnreadChats);
      }
    }, 0);
    
    return () => clearTimeout(timer);
  }, [chats, user, currentChatId, checkUnreadMessages]);

  // Pass messageLayout to children via cloneElement for the chat page
  const childrenWithProps = React.isValidElement(children) 
    ? React.cloneElement(children, { messageLayout } as any)
    : children;

  // Clean up old chat access records (older than 2 days)
  const cleanupOldAccessRecords = useCallback(() => {
    const recentAccess = cache.get<Record<string, number>>(CACHE_KEYS.RECENT_CHAT_ACCESS) || {};
    const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
    
    const filteredAccess: Record<string, number> = {};
    Object.entries(recentAccess).forEach(([chatId, timestamp]) => {
      if (timestamp > twoDaysAgo) {
        filteredAccess[chatId] = timestamp;
      }
    });
    
    cache.set(CACHE_KEYS.RECENT_CHAT_ACCESS, filteredAccess, CACHE_TTL.RECENT_CHAT_ACCESS);
  }, []);

  useEffect(() => {
    const fetchUserAndChats = async () => {
      // Always show skeleton on initial load for instant UI
      if (initialLoad) {
        setLoading(true);
      }

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }

      // Try to get user profile from cache first
      const cachedProfile = cache.get<Profile>(CACHE_KEYS.USER_PROFILE);
      let userProfile: Profile | null = cachedProfile;

      if (!cachedProfile || cachedProfile.id !== authUser.id) {
        // Fetch fresh profile data
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .eq("id", authUser.id)
          .single();
        
        userProfile = profileData;
        if (profileData) {
          cache.set(CACHE_KEYS.USER_PROFILE, profileData, CACHE_TTL.USER_PROFILE);
        }
      }

      setUser(userProfile);

      // Try to get chat list from cache first (only recently accessed chats)
      const cachedChats = cache.get<Chat[]>(CACHE_KEYS.CHAT_LIST);
      const recentlyAccessedChats = cachedChats?.filter(chat => isRecentlyAccessed(chat.id)) || [];
      
      if (recentlyAccessedChats.length > 0) {
        setChats(recentlyAccessedChats);
        setLoading(false);
        setInitialLoad(false);
        // Fetch fresh data in background
        fetchChatsFresh(authUser.id);
      } else {
        // No recently accessed cached chats, fetch fresh data
        await fetchChatsFresh(authUser.id);
        setInitialLoad(false);
      }
      
      // Set up real-time message listener
      const cleanup = setupMessageListener(authUser.id);
      return cleanup;
    };

    const fetchChatsFresh = async (userId: string) => {
      const { data: participantData } = await supabase
        .from("chat_participants")
        .select("chat_id")
        .eq("user_id", userId);

      if (participantData && participantData.length > 0) {
        const chatIds = participantData.map((p) => p.chat_id);
        
        // Get chats with their latest message
        const { data: chatsData } = await supabase
          .from("chats")
          .select("*")
          .in("id", chatIds)
          .order("updated_at", { ascending: false });

        if (chatsData) {
          const chatsWithParticipants = await Promise.all(
            chatsData.map(async (chat) => {
              const cacheKey = CACHE_KEYS.CHAT_PARTICIPANTS(chat.id);
              const cachedParticipants = cache.get<Profile[]>(cacheKey);
              
              // Get the latest message for this chat
              const { data: latestMessage } = await supabase
                .from("messages")
                .select("created_at")
                .eq("chat_id", chat.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();
              
              if (cachedParticipants && cachedParticipants.length > 0) {
                return {
                  ...chat,
                  participants: cachedParticipants,
                  last_message_at: latestMessage?.created_at || chat.updated_at,
                };
              }

              // Fetch fresh participant data
              const { data: participantsData } = await supabase
                .from("chat_participants")
                .select("user_id, profiles!inner(id, username, display_name)")
                .eq("chat_id", chat.id);
              
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const participants: Profile[] = participantsData?.map((p: any) => ({
                id: p.profiles.id,
                username: p.profiles.username,
                display_name: p.profiles.display_name,
              })) || [];
              
              // Cache participants
              cache.set(cacheKey, participants, CACHE_TTL.CHAT_PARTICIPANTS);
              
              return {
                ...chat,
                participants,
                last_message_at: latestMessage?.created_at || chat.updated_at,
              };
            })
          );
          
          console.log('Fetched chats with messages:', chatsWithParticipants);
          setChats(chatsWithParticipants);
          
          // Only cache recently accessed chats
          const recentlyAccessed = chatsWithParticipants.filter(chat => isRecentlyAccessed(chat.id));
          if (recentlyAccessed.length > 0) {
            cache.set(CACHE_KEYS.CHAT_LIST, recentlyAccessed, CACHE_TTL.CHAT_LIST);
          }
        }
      }
      setLoading(false);
    };

    // Set up real-time listener for new messages
    const setupMessageListener = (userId: string) => {
      const subscription = supabase
        .channel('new_messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
          },
          async (payload) => {
            const newMessage = payload.new as any;
            
            // Check if user is a participant in this chat
            const { data: participantCheck } = await supabase
              .from('chat_participants')
              .select('chat_id')
              .eq('user_id', userId)
              .eq('chat_id', newMessage.chat_id)
              .single();
            
            if (participantCheck && newMessage.sender_id !== userId) {
              // This is a new message for the user in a chat they're in
              // Update the chat's last_message_at but don't reorder
              setChats(prev => 
                prev.map(chat => 
                  chat.id === newMessage.chat_id 
                    ? { ...chat, last_message_at: newMessage.created_at, updated_at: newMessage.created_at }
                    : chat
                )
              );
              
              // Immediately update cache with new message if chat is recently accessed
              if (isRecentlyAccessed(newMessage.chat_id)) {
                const cachedChats = cache.get<Chat[]>(CACHE_KEYS.CHAT_LIST) || [];
                const updatedCache = cachedChats.map(chat => 
                  chat.id === newMessage.chat_id 
                    ? { ...chat, last_message_at: newMessage.created_at, updated_at: newMessage.created_at }
                    : chat
                );
                cache.set(CACHE_KEYS.CHAT_LIST, updatedCache, CACHE_TTL.CHAT_LIST);
                
                // Fetch sender profile for proper caching
                supabase
                  .from("profiles")
                  .select("username, display_name, avatar_url")
                  .eq("id", newMessage.sender_id)
                  .single()
                  .then(({ data: profileData }) => {
                    // Also update the message cache for this chat
                    const cachedMessages = cache.get<any[]>(CACHE_KEYS.CHAT_MESSAGES(newMessage.chat_id)) || [];
                    // Add the new message to the cache
                    const updatedMessages = [...cachedMessages, {
                      id: newMessage.id,
                      chat_id: newMessage.chat_id,
                      content: newMessage.content,
                      sender_id: newMessage.sender_id,
                      created_at: newMessage.created_at,
                      profiles: {
                        username: profileData?.username || "Unknown",
                        display_name: profileData?.display_name,
                        avatar_url: profileData?.avatar_url
                      }
                    }];
                    cache.set(CACHE_KEYS.CHAT_MESSAGES(newMessage.chat_id), updatedMessages, CACHE_TTL.CHAT_MESSAGES);
                  });
              }
              
              // Mark chat as unread if it's not the current chat
              if (newMessage.chat_id !== currentChatId) {
                setUnreadChats(prev => {
                  const newSet = new Set(prev);
                  newSet.add(newMessage.chat_id);
                  return newSet;
                });
              }
            }
          }
        );
      
      subscription.subscribe((status) => {
        console.log("Realtime subscription status:", status);
      });
      
      return () => subscription.unsubscribe();
    };

    // Clear expired cache on load and cleanup old access records
    cache.clearExpired();
    cleanupOldAccessRecords();
    
    fetchUserAndChats();
  }, [supabase, router, cleanupOldAccessRecords]);

  const signOut = async () => {
    // Clear all cache when signing out
    cache.clear();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleNewChat = () => {
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setSelectedUsers([]);
    setChatName("");
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleEditProfile = () => {
    setEditUsername(user?.username || "");
    setEditDisplayName(user?.display_name || "");
    setEditProfilePicture("");
    setEditingProfile(true);
  };

  const handlePfpUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      alert('Image size must be less than 5MB');
      return;
    }

    setUploadingPfp(true);

    try {
      // Create a preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setEditProfilePicture(e.target?.result as string);
        setUploadingPfp(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading image:', error);
      setUploadingPfp(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    
    const { error } = await supabase
      .from("profiles")
      .update({
        username: editUsername,
        display_name: editDisplayName || null,
        avatar_url: editProfilePicture || null,
      })
      .eq("id", user.id);

    if (error) {
      console.error("Error updating profile:", error);
      return;
    }

    const updatedProfile = {
      ...user,
      username: editUsername,
      display_name: editDisplayName || undefined,
      avatar_url: editProfilePicture || undefined,
    };

    setUser(updatedProfile);
    
    // Update cache with new profile data
    cache.set(CACHE_KEYS.USER_PROFILE, updatedProfile, CACHE_TTL.USER_PROFILE);
    
    setEditingProfile(false);
  };

  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }

      // Try cache first for user search
      const cacheKey = CACHE_KEYS.USER_SEARCH(searchQuery);
      const cachedResults = cache.get<Profile[]>(cacheKey);
      
      if (cachedResults) {
        setSearchResults(cachedResults);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .ilike("username", `%${searchQuery}%`)
        .neq("id", user?.id || "")
        .limit(10);

      const results = data || [];
      setSearchResults(results);
      
      // Cache search results
      if (results.length > 0) {
        cache.set(cacheKey, results, CACHE_TTL.USER_SEARCH);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, supabase, user]);

  const createChat = async () => {
    if (selectedUsers.length === 0 || isCreating) return;
    setIsCreating(true);

    const allParticipants = [...selectedUsers, user].filter(Boolean) as Profile[];
    const finalChatName = chatName.trim() || null;

    const { data: chat, error: chatError } = await supabase
      .from("chats")
      .insert({ name: finalChatName })
      .select()
      .single();

    if (chatError || !chat) {
      console.error("Error creating chat:", chatError);
      setIsCreating(false);
      return;
    }

    const creator = allParticipants.find((p) => p.id === user?.id);
    const others = allParticipants.filter((p) => p.id !== user?.id);

    if (creator) {
      const { error: creatorError } = await supabase
        .from("chat_participants")
        .insert({ chat_id: chat.id, user_id: creator.id });

      if (creatorError) {
        console.error("Error adding creator:", creatorError);
        setIsCreating(false);
        return;
      }
    }

    if (others.length > 0) {
      const { error: othersError } = await supabase
        .from("chat_participants")
        .insert(others.map((p) => ({ chat_id: chat.id, user_id: p.id })));

      if (othersError) {
        console.error("Error adding participants:", othersError);
        setIsCreating(false);
        return;
      }
    }

    // Refresh chat list
    const { data: newChatData } = await supabase
      .from("chats")
      .select("*")
      .eq("id", chat.id)
      .single();

    if (newChatData) {
      const { data: participantsData } = await supabase
        .from("chat_participants")
        .select("user_id, profiles!inner(id, username, display_name)")
        .eq("chat_id", chat.id);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const participants: Profile[] = participantsData?.map((p: any) => ({
        id: p.profiles.id,
        username: p.profiles.username,
        display_name: p.profiles.display_name,
      })) || [];

      const newChat: Chat = { ...newChatData, participants };
      setChats((prev) => [newChat, ...prev]);
      
      // Invalidate chat list cache since we added a new chat
      cache.delete(CACHE_KEYS.CHAT_LIST);
      // Mark the new chat as recently accessed
      markChatAccessed(chat.id);
    }

    closeModal();
    setIsCreating(false);
    router.push(`/chats/${chat.id}`);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar - Hidden on mobile when viewing a chat */}
      <div className={`${showSidebar ? 'flex' : 'hidden md:flex'} w-full md:w-80 bg-card border-r border-border flex-col shrink-0`}>
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-foreground">Chats</h1>
            <button
              onClick={handleNewChat}
              className="p-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
              title="New Chat"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {loading && initialLoad ? (
            <ChatListSkeleton />
          ) : loading && !initialLoad ? (
            <div className="p-4 text-center text-muted">Updating...</div>
          ) : chats.length === 0 ? (
            <div className="p-8 text-center text-muted">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No chats yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {chats.map((chat) => {
                const otherUsers = chat.participants.filter((p) => p.id !== user?.id);
                const chatTitle = chat.name || otherUsers.map((p) => p.display_name || p.username).join(", ") || "Just you";
                const avatarLetter = (chat.name || otherUsers[0]?.display_name || otherUsers[0]?.username || "?")[0].toUpperCase();
                const isActive = currentChatId === chat.id;
                
                return (
                  <Link
                    key={chat.id}
                    href={`/chats/${chat.id}`}
                    className={`block p-3 transition-colors ${
                      isActive 
                        ? "bg-accent/10 border-l-4 border-l-accent" 
                        : "hover:bg-card-hover border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {otherUsers.length === 1 ? (
                        // One-on-one chat - show the other person's profile picture
                        otherUsers[0].avatar_url ? (
                          <img 
                            src={otherUsers[0].avatar_url} 
                            alt="Profile" 
                            className={`w-10 h-10 rounded-full object-cover shrink-0 ${
                              isActive ? "ring-2 ring-accent" : ""
                            }`}
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                            isActive ? "bg-accent text-white" : "bg-border text-foreground"
                          }`}>
                            {(otherUsers[0].display_name || otherUsers[0].username || "?").charAt(0).toUpperCase()}
                          </div>
                        )
                      ) : (
                        // Group chat or no other users - show chat initial
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                          isActive ? "bg-accent text-white" : "bg-border text-foreground"
                        }`}>
                          {avatarLetter}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium truncate ${
                          isActive ? "text-accent" : "text-foreground"
                        }`}>
                          {chatTitle}
                        </div>
                        <div className="text-xs text-muted truncate">
                          {otherUsers.length > 0 
                            ? otherUsers.map((p) => `@${p.username}`).join(", ")
                            : "Just you"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {unreadChats.has(chat.id) && !isActive && (
                          <>
                            <UnreadDot />
                            {console.log('Showing dot for chat:', chat.id)}
                          </>
                        )}
                        <ChevronRight className={`w-4 h-4 shrink-0 ${
                          isActive ? "text-accent" : "text-muted"
                        }`} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer - Profile Section */}
        <div className="p-4 border-t border-border">
          {user ? (
            <div className="flex items-center gap-3">
              {user.avatar_url ? (
                <img 
                  src={user.avatar_url} 
                  alt="Profile" 
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 bg-border rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-foreground">
                    {(user.display_name || user.username || "?").charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">
                  {user.display_name || `@${user.username}`}
                </div>
                <div className="text-xs text-muted truncate">
                  @{user.username}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="p-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={signOut}
                  className="p-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <ProfileSkeleton />
          )}
        </div>
      </div>

      {/* Main Content - Hidden on mobile when viewing chat list */}
      <div className={`${showMainContent ? 'flex' : 'hidden md:flex'} flex-1 flex flex-col min-w-0`}>
        {childrenWithProps}
      </div>

      {/* Create Chat Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start md:items-center justify-center z-50 md:p-4">
          <div className="bg-card border-0 md:border md:border-border md:rounded-2xl w-full h-full md:h-auto md:max-w-md md:max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={closeModal}
                  className="md:hidden p-2 -ml-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-semibold text-foreground">New Chat</h2>
              </div>
              <button
                onClick={closeModal}
                className="hidden md:block text-muted hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Chat Name (optional)
                </label>
                <input
                  type="text"
                  value={chatName}
                  onChange={(e) => setChatName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                  placeholder="e.g., Team Discussion"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Add People by Username
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                  placeholder="Search usernames..."
                />
              </div>

              {searchQuery && searchResults.length === 0 && !loading ? (
                <div className="border border-border rounded-lg divide-y divide-border bg-background">
                  <div className="p-3 text-center text-muted">
                    <div className="text-sm">No users found for &quot;{searchQuery}&quot;</div>
                  </div>
                </div>
              ) : searchQuery && searchResults.length === 0 && loading ? (
                <SearchSkeleton />
              ) : searchResults.length > 0 ? (
                <div className="border border-border rounded-lg divide-y divide-border bg-background">
                  {searchResults.map((profile) => (
                    <button
                      key={profile.id}
                      onClick={() => {
                        if (!selectedUsers.find((u) => u.id === profile.id)) {
                          setSelectedUsers([...selectedUsers, profile]);
                        }
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="w-full p-3 text-left hover:bg-card-hover flex items-center gap-3 transition-colors"
                    >
                      <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center text-sm font-medium text-accent">
                        {profile.username[0].toUpperCase()}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">@{profile.username}</span>
                        {profile.display_name && (
                          <span className="text-sm text-muted ml-1">({profile.display_name})</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedUsers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Selected ({selectedUsers.length})
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selectedUsers.map((u) => (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-full text-sm text-accent"
                      >
                        @{u.username}
                        <button
                          onClick={() =>
                            setSelectedUsers(selectedUsers.filter((su) => su.id !== u.id))
                          }
                          className="hover:text-accent-hover transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border">
              <button
                onClick={createChat}
                disabled={selectedUsers.length === 0 || isCreating}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? "Creating..." : "Create Chat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start md:items-center justify-center z-50 md:p-4"
          onClick={() => setShowSettingsModal(false)}
        >
          <div 
            className="bg-card border-0 md:border md:border-border md:rounded-2xl w-full h-full md:h-auto md:max-w-md md:max-h-[80vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="md:hidden p-2 -ml-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-semibold text-foreground">Settings</h2>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="hidden md:block text-muted hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Profile Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Profile</h3>
                  {!editingProfile && (
                    <button
                      onClick={handleEditProfile}
                      className="text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
                
                {!editingProfile ? (
                  <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
                    {user?.avatar_url ? (
                      <img 
                        src={user.avatar_url} 
                        alt="Profile" 
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-border rounded-full flex items-center justify-center">
                        <span className="text-lg font-medium text-foreground">
                          {(user?.display_name || user?.username || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="font-medium text-foreground">
                        {user?.display_name || `@${user?.username}`}
                      </div>
                      <div className="text-sm text-muted">
                        @{user?.username}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
                      <div className="relative">
                        {editProfilePicture ? (
                          <img 
                            src={editProfilePicture} 
                            alt="Profile" 
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-accent rounded-full flex items-center justify-center">
                            <span className="text-lg font-medium text-white">
                              {(editDisplayName || editUsername || "?").charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <label className="absolute -bottom-1 -right-1 w-6 h-6 bg-accent hover:bg-accent-hover rounded-full flex items-center justify-center cursor-pointer transition-colors">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePfpUpload}
                            className="hidden"
                            disabled={uploadingPfp}
                          />
                          {uploadingPfp ? (
                            <div className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <Plus className="w-3 h-3 text-white" />
                          )}
                        </label>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">
                          {editDisplayName || `@${editUsername}`}
                        </div>
                        <div className="text-sm text-muted">
                          @{editUsername}
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Username
                      </label>
                      <input
                        type="text"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="w-full px-3 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                        placeholder="username"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Display Name (optional)
                      </label>
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        className="w-full px-3 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                        placeholder="Your display name"
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={saveProfile}
                        className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingProfile(false)}
                        className="flex-1 py-2.5 bg-background border border-border hover:bg-card-hover text-foreground font-medium rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Appearance Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Appearance</h3>
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-3 bg-background border border-border rounded-lg cursor-pointer hover:bg-card-hover transition-colors">
                    <span className="text-sm text-foreground">Dark Mode</span>
                    <div className="w-12 h-6 bg-accent rounded-full relative">
                      <div className="absolute right-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform"></div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Message Layout Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Message Layout</h3>
                <div className="space-y-2">
                  <select
                    value={messageLayout}
                    onChange={(e) => setMessageLayout(e.target.value as "default" | "left")}
                    className="w-full p-3 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  >
                    <option value="default">Default Layout - Your messages on the right, others on the left</option>
                    <option value="left">Left Aligned - All messages on the left side</option>
                  </select>
                </div>
              </div>

              {/* Notifications Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Notifications</h3>
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-3 bg-background border border-border rounded-lg cursor-pointer hover:bg-card-hover transition-colors">
                    <span className="text-sm text-foreground">Message Notifications</span>
                    <div className="w-12 h-6 bg-accent rounded-full relative">
                      <div className="absolute right-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform"></div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Cache Management Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Cache Management</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      cache.clear();
                      window.location.reload();
                    }}
                    className="w-full p-3 bg-background border border-border rounded-lg text-left hover:bg-card-hover transition-colors flex items-center gap-3"
                  >
                    <div className="w-4 h-4 text-muted">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"/>
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-foreground">Clear All Cache</div>
                      <div className="text-xs text-muted">Remove cached data and refresh</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Account Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Account</h3>
                <button
                  onClick={signOut}
                  className="w-full p-3 bg-background border border-border rounded-lg text-left hover:bg-card-hover transition-colors flex items-center gap-3"
                >
                  <LogOut className="w-4 h-4 text-muted" />
                  <span className="text-sm text-foreground">Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
