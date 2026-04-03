"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Plus, ChevronRight, LogOut, X } from "lucide-react";

type Profile = {
  id: string;
  username: string;
  display_name?: string;
};

type Chat = {
  id: string;
  name: string | null;
  participants: Profile[];
};

export default function ChatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [chatName, setChatName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const params = useParams();
  const currentChatId = params?.id as string | undefined;
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const fetchUserAndChats = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .eq("id", authUser.id)
        .single();
      
      setUser(profileData);

      const { data: participantData } = await supabase
        .from("chat_participants")
        .select("chat_id")
        .eq("user_id", authUser.id);

      if (participantData && participantData.length > 0) {
        const chatIds = participantData.map((p) => p.chat_id);
        
        const { data: chatsData } = await supabase
          .from("chats")
          .select("*")
          .in("id", chatIds)
          .order("updated_at", { ascending: false });

        if (chatsData) {
          const chatsWithParticipants = await Promise.all(
            chatsData.map(async (chat) => {
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
              
              return {
                ...chat,
                participants,
              };
            })
          );
          setChats(chatsWithParticipants);
        }
      }
      setLoading(false);
    };

    fetchUserAndChats();
  }, [supabase, router]);

  const signOut = async () => {
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

  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .ilike("username", `%${searchQuery}%`)
        .neq("id", user?.id || "")
        .limit(10);

      setSearchResults(data || []);
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
    }

    closeModal();
    setIsCreating(false);
    router.push(`/chats/${chat.id}`);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <div className="w-80 bg-card border-r border-border flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Chats</h1>
              <p className="text-xs text-muted">
                @{user?.username}
              </p>
            </div>
          </div>
          <button
            onClick={handleNewChat}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-muted">Loading...</div>
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
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                        isActive ? "bg-accent text-white" : "bg-border text-foreground"
                      }`}>
                        {avatarLetter}
                      </div>
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
                      <ChevronRight className={`w-4 h-4 shrink-0 ${
                        isActive ? "text-accent" : "text-muted"
                      }`} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <button
            onClick={signOut}
            className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>

      {/* Create Chat Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">New Chat</h2>
              <button
                onClick={closeModal}
                className="text-muted hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
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

              {searchResults.length > 0 && (
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
              )}

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
    </div>
  );
}
