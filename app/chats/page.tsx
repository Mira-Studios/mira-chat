"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { MessageSquare, Plus, ChevronRight, X } from "lucide-react";
import Link from "next/link";

type Profile = {
  id: string;
  username: string;
  display_name?: string;
};

type Chat = {
  id: string;
  name: string | null;
  participants: Profile[];
  last_message?: string;
};

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [chatName, setChatName] = useState("");
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const fetchUserAndChats = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
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
                .select("user_id, profiles!inner(id, username)")
                .eq("chat_id", chat.id);
              
              const participants: Profile[] = participantsData?.map((p: any) => ({
                id: p.profiles.id,
                username: p.profiles.username,
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

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${query}%`)
      .neq("id", user?.id || "")
      .limit(10);

    setSearchResults(data || []);
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      searchUsers(searchQuery);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const createChat = async () => {
    if (selectedUsers.length === 0) return;

    const allParticipants = [...selectedUsers, user].filter(Boolean) as Profile[];
    
    // Only save explicit chat name, let UI show other participants dynamically
    const finalChatName = chatName.trim() || null;

    const { data: chat, error: chatError } = await supabase
      .from("chats")
      .insert({ name: finalChatName })
      .select()
      .single();

    if (chatError || !chat) {
      console.error("Error creating chat:", chatError);
      return;
    }

    // Insert creator first (required by RLS policy), then others
    const creator = allParticipants.find((p) => p.id === user?.id);
    const others = allParticipants.filter((p) => p.id !== user?.id);

    if (creator) {
      const { error: creatorError } = await supabase
        .from("chat_participants")
        .insert({ chat_id: chat.id, user_id: creator.id });

      if (creatorError) {
        console.error("Error adding creator:", creatorError);
        return;
      }
    }

    if (others.length > 0) {
      const { error: othersError } = await supabase
        .from("chat_participants")
        .insert(others.map((p) => ({ chat_id: chat.id, user_id: p.id })));

      if (othersError) {
        console.error("Error adding participants:", othersError);
        return;
      }
    }

    setShowCreateModal(false);
    setSelectedUsers([]);
    setChatName("");
    setSearchQuery("");
    router.push(`/chats/${chat.id}`);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto">
        <div className="bg-card border-x border-border min-h-screen">
          <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card/95 backdrop-blur-sm z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Chats</h1>
                <p className="text-xs text-muted">
                @{user?.username}
                {user?.display_name && <span className="ml-1">({user.display_name})</span>}
              </p>
              </div>
            </div>
            <button
              onClick={signOut}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>

          <div className="p-4">
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              New Chat
            </button>
          </div>

          <div className="divide-y divide-border">
            {chats.length === 0 ? (
              <div className="p-8 text-center text-muted">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No chats yet. Create your first chat!</p>
              </div>
            ) : (
              chats.map((chat) => {
                const otherUsers = chat.participants.filter((p) => p.id !== user?.id);
                const chatTitle = chat.name || otherUsers.map((p) => p.display_name || p.username).join(", ") || "Just you";
                const avatarLetter = (chat.name || otherUsers[0]?.display_name || otherUsers[0]?.username || "?")[0].toUpperCase();
                
                return (
                  <Link
                    key={chat.id}
                    href={`/chats/${chat.id}`}
                    className="block p-4 hover:bg-card-hover transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-border rounded-full flex items-center justify-center text-sm font-medium text-foreground shrink-0">
                        {avatarLetter}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {chatTitle}
                        </div>
                        <div className="text-sm text-muted truncate">
                          {otherUsers.length > 0 
                            ? otherUsers.map((p) => `@${p.username}`).join(", ")
                            : "Just you"}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted shrink-0" />
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">New Chat</h2>
              <button
                onClick={() => setShowCreateModal(false)}
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
                      <span className="font-medium text-foreground">@{profile.username}</span>
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
                disabled={selectedUsers.length === 0}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
