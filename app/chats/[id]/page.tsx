"use client";

import { useEffect, useState, useRef, use, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Send, Users, Settings, X, Plus, UserMinus, UserPlus, ArrowLeft, MoreVertical, Smile, Trash2, Edit2, Check, X as XIcon, Reply, Pin, Paperclip, Image, Video, FileText } from "lucide-react";
import { cache, CACHE_KEYS, CACHE_TTL } from "@/lib/cache";

const MESSAGES_PER_PAGE = 50;
const MESSAGE_BUFFER = 100; // Keep this many messages loaded at most
const CONSECUTIVE_MESSAGE_THRESHOLD = 3 * 60 * 1000; // 3 minutes in milliseconds
const TIME_DISPLAY_THRESHOLD = 2 * 60 * 1000; // 2 minutes in milliseconds

// Long press detection hook - must be at module level
function useLongPress(
  callback: () => void,
  onTouchStart?: (e: React.TouchEvent) => void
) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const start = useCallback((e: React.TouchEvent) => {
    onTouchStart?.(e);
    timerRef.current = setTimeout(() => {
      callback();
    }, 500);
  }, [callback, onTouchStart]);

  const end = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const move = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onTouchStart: start,
    onTouchEnd: end,
    onTouchMove: move,
  };
}

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

type Reaction = {
  id: string;
  message_id: string;
  user_id: string;
  reaction: string;
  created_at: string;
};

type Message = {
  id: string;
  chat_id?: string;
  content: string;
  sender_id: string;
  created_at: string;
  edited_at?: string;
  reply_to?: string;
  client_key?: string;
  profiles: {
    username: string;
    display_name?: string;
    avatar_url?: string;
  };
  reactions?: Reaction[];
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

type Profile = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
};

// Separate Message component to properly use hooks
interface MessageItemProps {
  message: Message;
  index: number;
  messages: Message[];
  userId: string | null;
  myProfile: Participant | undefined;
  messageLayout: "default" | "left";
  selectedMessageId: string | null;
  editingMessageId: string | null;
  editMessageContent: string;
  showMessageMenu: string | null;
  showReactionPicker: string | null;
  onSelectMessage: (id: string, isMe: boolean) => void;
  onStartEdit: (message: Message) => void;
  onStartReply: (message: Message) => void;
  onReplyClick: (messageId: string) => void;
  onAddReaction: (messageId: string, reaction: string) => void;
  onRemoveReaction: (messageId: string, reactionId: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onSetEditContent: (content: string) => void;
  onToggleMenu: (id: string, isOpen: boolean) => void;
  onToggleReactionPicker: (id: string, isOpen: boolean) => void;
  formatTime: (date: string) => string;
  renderFileAttachments: (content: string) => React.ReactNode;
  extractTextContent: (content: string) => string;
}

function MessageItem({
  message,
  index,
  messages,
  userId,
  myProfile,
  messageLayout,
  selectedMessageId,
  editingMessageId,
  editMessageContent,
  showMessageMenu,
  showReactionPicker,
  onSelectMessage,
  onStartEdit,
  onStartReply,
  onReplyClick,
  onAddReaction,
  onRemoveReaction,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onSetEditContent,
  onToggleMenu,
  onToggleReactionPicker,
  formatTime,
  renderFileAttachments,
  extractTextContent,
}: MessageItemProps) {
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
  const isSelected = selectedMessageId === message.id;
  const isEditing = editingMessageId === message.id;
  const isMenuOpen = showMessageMenu === message.id;
  const isReactionPickerOpen = showReactionPicker === message.id;

  const longPress = useLongPress(
    () => {
      if (isMe) onSelectMessage(message.id, isMe);
    },
    (e) => {
      if (!isMe) return;
      e.preventDefault();
    }
  );

  // Available reactions
  const availableReactions = [
    { emoji: '👍', name: 'thumbs_up' },
    { emoji: '😭', name: 'crying' },
  ];

  // Get reaction counts for this message
  const reactionCounts = message.reactions?.reduce((acc, reaction) => {
    acc[reaction.reaction] = (acc[reaction.reaction] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // Check if user has reacted with a specific reaction
  const hasUserReacted = (reactionName: string) => {
    return message.reactions?.some(r => r.user_id === userId && r.reaction === reactionName) || false;
  };

  // Reaction Picker Component
  const reactionPicker = isReactionPickerOpen && (
    <div className="absolute right-0 top-0 -mt-10 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg p-1.5 z-30">
      {availableReactions.map(({ emoji, name }) => (
        <button
          key={name}
          onClick={(e) => {
            e.stopPropagation();
            if (hasUserReacted(name)) {
              const existingReaction = message.reactions?.find(r => r.user_id === userId && r.reaction === name);
              if (existingReaction) {
                onRemoveReaction(message.id, existingReaction.id);
              }
            } else {
              onAddReaction(message.id, name);
            }
            onToggleReactionPicker(message.id, false);
          }}
          className={`p-1.5 hover:bg-accent/10 rounded-md transition-colors text-lg ${hasUserReacted(name) ? 'bg-accent/20' : ''}`}
          title={name.replace('_', ' ')}
        >
          {emoji}
        </button>
      ))}
    </div>
  );

  // Reactions Display Component
  const reactionsDisplay = Object.keys(reactionCounts).length > 0 && (
    <div className={`flex flex-wrap gap-0.5 mt-0.5 ${isMe && messageLayout !== "left" ? "justify-end" : "justify-start"}`}>
      {Object.entries(reactionCounts).map(([reactionName, count]) => {
        const emoji = availableReactions.find(r => r.name === reactionName)?.emoji || reactionName;
        const userHasReacted = hasUserReacted(reactionName);
        return (
          <button
            key={reactionName}
            onClick={(e) => {
              e.stopPropagation();
              if (userHasReacted) {
                const existingReaction = message.reactions?.find(r => r.user_id === userId && r.reaction === reactionName);
                if (existingReaction) {
                  onRemoveReaction(message.id, existingReaction.id);
                }
              } else {
                onAddReaction(message.id, reactionName);
              }
            }}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
              userHasReacted 
                ? 'bg-accent/20 border-accent/50 text-accent' 
                : 'bg-card-hover border-border hover:bg-accent/10'
            }`}
          >
            <span className="text-sm">{emoji}</span>
            <span className="text-xs font-medium leading-none">{count}</span>
          </button>
        );
      })}
    </div>
  );
  const repliedToMessage = message.reply_to ? messages.find(m => m.id === message.reply_to) : null;
  const repliedToSender = repliedToMessage 
    ? (repliedToMessage.sender_id === userId 
        ? (myProfile?.display_name || "You") 
        : (repliedToMessage.profiles?.display_name || repliedToMessage.profiles?.username || "Unknown"))
    : null;

  // Reply Preview Component - Discord style L-shape
  const replyPreview = repliedToMessage && (
    <div 
      className={`flex items-start gap-2 -mb-0.5 cursor-pointer hover:opacity-80 transition-opacity ${isMe && messageLayout !== "left" ? "flex-row-reverse" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onReplyClick(repliedToMessage.id);
      }}
    >
      <div className={`w-4 h-4 mt-0.5 relative flex-shrink-0 ${isMe && messageLayout !== "left" ? "ml-1" : "mr-0.5"}`}>
        <div className={`absolute top-0 w-4 h-3 border-t-2 border-accent/40 rounded-tl-sm ${isMe && messageLayout !== "left" ? "right-0 border-r-2 rounded-tr-sm" : "left-0 border-l-2"}`} />
      </div>
      <div className="flex-1 min-w-0 -mt-1">
        <div className={`flex items-center gap-2 ${isMe && messageLayout !== "left" ? "flex-row-reverse" : ""}`}>
          <span className="text-xs font-medium text-accent">
            {repliedToSender}
          </span>
          <span className="text-xs text-muted truncate">
            {repliedToMessage.content.slice(0, 80)}{repliedToMessage.content.length > 80 ? "..." : ""}
          </span>
        </div>
      </div>
    </div>
  );

  // Context Menu content - shown for ALL messages
  const contextMenuContent = isMenuOpen && (
    <div 
      className="absolute right-0 -top-8 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg p-1 z-20"
      onMouseEnter={(e) => e.stopPropagation()}
      onMouseLeave={(e) => {
        e.stopPropagation();
        onToggleMenu(message.id, false);
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleReactionPicker(message.id, !isReactionPickerOpen); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="Add reaction"
      >
        <Smile className="w-4 h-4 text-muted" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onStartReply(message); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="Reply"
      >
        <Reply className="w-4 h-4 text-muted" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); console.log('Pin message'); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="Pin message"
      >
        <Pin className="w-4 h-4 text-muted" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); console.log('Forward message'); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="Forward message"
      >
        <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>
      {isMe && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit(message); }}
            className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
            title="Edit"
          >
            <Edit2 className="w-4 h-4 text-muted" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(message.id); }}
            className="p-1.5 hover:bg-red-500/10 rounded-md transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
        </>
      )}
    </div>
  );

  // Message Actions Bar content - always on right side, shown for ALL messages
  const messageActionsContent = (
    <div className={`absolute right-0 -top-8 flex items-center gap-0.5 bg-card-hover border border-border rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10 mr-1`}>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleReactionPicker(message.id, !isReactionPickerOpen); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="Add reaction"
      >
        <Smile className="w-4 h-4 text-muted" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onStartReply(message); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="Reply"
      >
        <Reply className="w-4 h-4 text-muted" />
      </button>
      {isMe && (
        <button
          onClick={(e) => { e.stopPropagation(); onStartEdit(message); }}
          className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
          title="Edit"
        >
          <Edit2 className="w-4 h-4 text-muted" />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleMenu(message.id, !isMenuOpen); }}
        className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
        title="More"
      >
        <MoreVertical className="w-4 h-4 text-muted" />
      </button>
    </div>
  );

  if (isMe) {
    const shouldAlignLeft = messageLayout === "left";
    if (shouldAlignLeft) {
      return (
        <div
          data-message-container
          data-message-id={message.id}
          className={`flex justify-start px-4 rounded-lg transition-colors relative group ${
            isSelected ? 'bg-accent/20' : 'hover:bg-accent/5'
          } ${isDifferentSender ? "pt-2 pb-0.5" : "py-0.5"}`}
          onClick={() => onSelectMessage(message.id, isMe)}
          {...longPress}
        >
          {contextMenuContent}
          {messageActionsContent}
          <div className="flex gap-3 max-w-[80%]">
            {shouldShowMyProfile && (
              <>
                {myProfile?.avatar_url ? (
                  <img src={myProfile.avatar_url} alt="Profile" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
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
                      {message.edited_at && <span className="ml-1">(edited)</span>}
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
                      {message.edited_at && <span className="ml-1">(edited)</span>}
                    </div>
                  </div>
                </div>
              )}
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editMessageContent}
                    onChange={(e) => onSetEditContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSaveEdit();
                      if (e.key === 'Escape') onCancelEdit();
                    }}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={onSaveEdit} className="px-3 py-1 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors">Save</button>
                    <button onClick={onCancelEdit} className="px-3 py-1 bg-background border border-border text-foreground rounded-md hover:bg-card-hover transition-colors">Cancel</button>
                    <span className="text-muted">press enter to save</span>
                  </div>
                </div>
              ) : (
                <>
                  {reactionPicker}
                  {replyPreview}
                  {renderFileAttachments(message.content)}
                  {extractTextContent(message.content) && (
                    <div className="leading-relaxed text-foreground break-words overflow-wrap-anywhere">
                      {extractTextContent(message.content)}
                    </div>
                  )}
                  {reactionsDisplay}
                </>
              )}
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div
          data-message-container
          data-message-id={message.id}
          className={`flex justify-end px-4 rounded-lg transition-colors relative group ${
            isSelected ? 'bg-accent/20' : 'hover:bg-accent/5'
          } ${isDifferentSender ? "pt-2 pb-0.5" : "py-0.5"}`}
          onClick={() => onSelectMessage(message.id, isMe)}
          {...longPress}
        >
          {contextMenuContent}
          {messageActionsContent}
          <div className="max-w-[80%] text-right">
            {shouldShowTime && (
              <div className="flex items-center justify-end mb-1">
                <div className="text-xs text-muted mr-2">
                  {formatTime(message.created_at)}
                  {message.edited_at && <span className="ml-1">(edited)</span>}
                </div>
                <div className="text-sm font-medium text-foreground">
                  {myProfile?.display_name || `@${myProfile?.username}` || "You"}
                </div>
              </div>
            )}
            {isEditing ? (
              <div className="flex flex-col gap-2 text-left">
                <input
                  type="text"
                  value={editMessageContent}
                  onChange={(e) => onSetEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSaveEdit();
                    if (e.key === 'Escape') onCancelEdit();
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  autoFocus
                />
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={onSaveEdit} className="px-3 py-1 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors">Save</button>
                  <button onClick={onCancelEdit} className="px-3 py-1 bg-background border border-border text-foreground rounded-md hover:bg-card-hover transition-colors">Cancel</button>
                  <span className="text-muted">press enter to save</span>
                </div>
              </div>
            ) : (
              <>
                {reactionPicker}
                {replyPreview}
                {renderFileAttachments(message.content)}
                {extractTextContent(message.content) && (
                  <div className="leading-relaxed text-foreground break-words overflow-wrap-anywhere max-w-full">
                    {extractTextContent(message.content)}
                  </div>
                )}
                {reactionsDisplay}
              </>
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <div
      data-message-container
      data-message-id={message.id}
      className={`flex justify-start px-4 rounded-lg transition-colors relative group ${
        isSelected ? 'bg-accent/20' : 'hover:bg-accent/5'
      } ${isDifferentSender ? "pt-2 pb-0.5" : "py-0.5"}`}
      onClick={() => onSelectMessage(message.id, isMe)}
    >
      {contextMenuContent}
      {messageActionsContent}
      <div className="flex gap-3 max-w-[80%]">
        {shouldShowProfile && (
          <>
            {message.profiles.avatar_url ? (
              <img src={message.profiles.avatar_url} alt="Profile" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
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
                  {message.edited_at && <span className="ml-1">(edited)</span>}
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
                  {message.edited_at && <span className="ml-1">(edited)</span>}
                </div>
              </div>
            </div>
          )}
          {replyPreview}
          {renderFileAttachments(message.content)}
          {extractTextContent(message.content) && (
            <div className="leading-relaxed text-foreground break-words overflow-wrap-anywhere">
              {extractTextContent(message.content)}
            </div>
          )}
          {reactionsDisplay}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [mediaModal, setMediaModal] = useState<{ url: string; type: string; name: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
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
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageContent, setEditMessageContent] = useState("");
  const [showMessageMenu, setShowMessageMenu] = useState<string | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

      // Try to get cached messages first
      const cachedMessages = cache.get<Message[]>(CACHE_KEYS.CHAT_MESSAGES(chatId));
      const cachedChatData = cache.get<any>(`chat_data_${chatId}`);
      const cachedParticipants = cache.get<Participant[]>(`chat_participants_${chatId}`);
      
      // Show cached data immediately if available
      if (cachedMessages && cachedMessages.length > 0 && cachedChatData && cachedParticipants) {
        setChat(cachedChatData);
        setParticipants(cachedParticipants);
        setMessages(cachedMessages);
        setPagination({
          hasMoreOlder: cachedMessages.length >= MESSAGES_PER_PAGE,
          hasMoreNewer: false,
          oldestLoadedAt: cachedMessages[0]?.created_at,
          newestLoadedAt: cachedMessages[cachedMessages.length - 1]?.created_at,
        });
        setLoading(false);
        
        // Fetch fresh data in background
        fetchFreshChatData(user.id);
      } else {
        // No cache, fetch fresh data
        await fetchFreshChatData(user.id);
      }
    };

    const fetchFreshChatData = async (userId: string) => {
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

      const isParticipant = mappedParticipants.some((p) => p.id === userId);
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

      // Fetch reactions for these messages
      const messageIds = messagesData?.map(m => m.id) || [];
      let reactionsData: Reaction[] = [];
      if (messageIds.length > 0) {
        const { data: reactions } = await supabase
          .from("reactions")
          .select("*")
          .in("message_id", messageIds);
        reactionsData = reactions || [];
      }

      // Merge reactions into messages
      const messagesWithReactions = messagesData?.map(msg => ({
        ...msg,
        reactions: reactionsData.filter(r => r.message_id === msg.id),
      })) || [];

      const orderedMessages = messagesWithReactions.reverse();
      setMessages(orderedMessages);
      setPagination({
        hasMoreOlder: (messagesData?.length || 0) >= MESSAGES_PER_PAGE,
        hasMoreNewer: false,
        oldestLoadedAt: orderedMessages[0]?.created_at,
        newestLoadedAt: orderedMessages[orderedMessages.length - 1]?.created_at,
      });
      
      // Cache the data for instant loading next time
      cache.set(CACHE_KEYS.CHAT_MESSAGES(chatId), orderedMessages, CACHE_TTL.CHAT_MESSAGES);
      cache.set(`chat_data_${chatId}`, chatData, CACHE_TTL.CHAT_MESSAGES);
      cache.set(`chat_participants_${chatId}`, mappedParticipants, CACHE_TTL.CHAT_MESSAGES);
      
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
        // Fetch reactions for new messages
        const newMessageIds = messagesData.map(m => m.id);
        let newReactionsData: Reaction[] = [];
        if (newMessageIds.length > 0) {
          const { data: reactions } = await supabase
            .from("reactions")
            .select("*")
            .in("message_id", newMessageIds);
          newReactionsData = reactions || [];
        }

        const messagesWithReactions = messagesData.map(msg => ({
          ...msg,
          reactions: newReactionsData.filter(r => r.message_id === msg.id),
        }));

        setMessages((prev) => {
          const currentIds = new Set(prev.map((m) => m.id));
          const currentKeys = new Set(prev.map((m) => m.client_key).filter(Boolean));
          
          const newMessages = (messagesWithReactions as Message[]).filter((m) => {
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

    console.log("Setting up realtime subscription for chat:", chatId);
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
          console.log("Message details:", { chatId: msg.chat_id, currentChatId: chatId, senderId: msg.sender_id });
          
          // Always process notifications for any message in any chat when page is inactive
          if (!isPageActive() && msg.sender_id !== userId) {
            console.log("Page inactive and message from other user, checking notification conditions");
            
            // Fetch sender profile
            const { data: senderProfile } = await supabase
              .from('profiles')
              .select('username, display_name')
              .eq('id', msg.sender_id)
              .single();
            
            const senderName = senderProfile?.display_name || senderProfile?.username || 'Unknown';
            
            // Get chat name for this message
            const { data: chatData } = await supabase
              .from('chats')
              .select('name')
              .eq('id', msg.chat_id)
              .single();
            
            const chatName = chatData?.name || 'New Message';
            
            const messageContent = extractTextContent(msg.content);
            const displayContent = messageContent || (msg.content.includes('files') ? 'Sent a file' : 'Sent a message');
            
            console.log('Showing notification:', {
              chatName,
              displayContent,
              senderName,
              messageChatId: msg.chat_id,
              currentChatId: chatId
            });
            
            showNotification(
              chatName,
              displayContent,
              senderName
            );
          }
          
          // Only process message for UI if it's for the current chat
          if (msg.chat_id !== chatId) {
            console.log("Message not for this chat, ignoring for UI");
            return;
          }
          
          console.log("Processing message for this chat UI");
          
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
            let updatedMessages;
            
            // If this is our message with a matching client_key, replace the optimistic one
            if (msg.client_key) {
              const hasOptimistic = prev.some(
                (m) => m.client_key === msg.client_key && m.id.startsWith("temp-")
              );
              if (hasOptimistic) {
                updatedMessages = prev.map((m) =>
                  m.client_key === msg.client_key
                    ? { ...newMsg, profiles: { username: "You" } }
                    : m
                );
              } else {
                updatedMessages = [...prev, newMsg];
              }
            } else {
              // Otherwise just add it (from other users)
              updatedMessages = [...prev, newMsg];
            }
            
            // Update cache with new message
            cache.set(CACHE_KEYS.CHAT_MESSAGES(chatId), updatedMessages, CACHE_TTL.CHAT_MESSAGES);
            
            return updatedMessages;
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

  // Scroll to bottom when images/content changes size
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !isNearBottomRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "auto",
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

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
      // Fetch reactions for older messages
      const olderMessageIds = olderMessages.map(m => m.id);
      let olderReactionsData: Reaction[] = [];
      if (olderMessageIds.length > 0) {
        const { data: reactions } = await supabase
          .from("reactions")
          .select("*")
          .in("message_id", olderMessageIds);
        olderReactionsData = reactions || [];
      }

      // Merge reactions into older messages
      const olderMessagesWithReactions = olderMessages.map(msg => ({
        ...msg,
        reactions: olderReactionsData.filter(r => r.message_id === msg.id),
      }));

      const ordered = olderMessagesWithReactions.reverse();
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachedFiles(prev => [...prev, ...files]);
    // Reset the input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    const files: File[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    
    if (files.length > 0) {
      e.preventDefault();
      setAttachedFiles(prev => [...prev, ...files]);
    }
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    const fileUrls: string[] = [];
    
    for (const file of files) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${chatId}/${fileName}`;
      
      const { data, error } = await supabase.storage
        .from('chat-files')
        .upload(filePath, file);
      
      if (error) {
        console.error('Error uploading file:', error);
        continue;
      }
      
      const { data: { publicUrl } } = supabase.storage
        .from('chat-files')
        .getPublicUrl(filePath);
      
      fileUrls.push(publicUrl);
    }
    
    return fileUrls;
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachedFiles.length === 0) || !userId) return;

    const content = newMessage.trim();
    const replyToId = replyingToMessage?.id;
    setNewMessage("");
    setReplyingToMessage(null);
    setIsUploading(true);
    
    let fileUrls: string[] = [];
    if (attachedFiles.length > 0) {
      fileUrls = await uploadFiles(attachedFiles);
    }
    
    setAttachedFiles([]);
    setIsUploading(false);

    // Create message content with file attachments
    let messageContent = content;
    if (fileUrls.length > 0) {
      const fileData = attachedFiles.map((file, index) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        url: fileUrls[index]
      }));
      
      if (content) {
        messageContent = content + "\n\n" + JSON.stringify({ files: fileData });
      } else {
        messageContent = JSON.stringify({ files: fileData });
      }
    }

    // Optimistically add message to UI
    const clientKey = `ck-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      chat_id: chatId,
      content: messageContent,
      sender_id: userId,
      created_at: new Date().toISOString(),
      client_key: clientKey,
      reply_to: replyToId,
      profiles: { username: "You" },
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const { error } = await supabase.from("messages").insert({
      chat_id: chatId,
      content: messageContent,
      sender_id: userId,
      reply_to: replyToId || null,
      client_key: clientKey,
    });

    if (error) {
      console.error("Error sending message:", error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
  };

  // Notification functions
  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      return permission;
    }
    return Notification.permission;
  };

  const showNotification = (title: string, body: string, sender?: string) => {
    console.log('Attempting to show notification:', { title, body, sender, permission: Notification.permission });
    
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        console.log('Permission granted, creating notification');
        const notification = new Notification(title, {
          body: sender ? `${sender}: ${body}` : body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: chatId, // Prevent duplicate notifications for same chat
          requireInteraction: false,
        });

        // Click notification to focus the window
        notification.onclick = () => {
          window.focus();
          notification.close();
        };

        // Auto-close after 5 seconds
        setTimeout(() => {
          notification.close();
        }, 5000);
      } else if (Notification.permission === 'denied') {
        console.log('Notification permission denied');
      } else {
        console.log('Notification permission not granted, requesting...');
        requestNotificationPermission();
      }
    } else {
      console.log('Notifications not supported in this browser');
    }
  };

  const isPageActive = () => {
    return !document.hidden && document.hasFocus();
  };

  const extractTextContent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.files && Array.isArray(parsed.files)) {
        // Return empty string if message only contains files
        return '';
      }
    } catch (e) {
      // Not JSON, return original content
    }
    return content;
  };

  const renderFileAttachments = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.files && Array.isArray(parsed.files)) {
        return (
          <div className="space-y-2">
            {parsed.files.map((file: any, index: number) => (
              <div key={index} className="rounded-lg overflow-hidden bg-card-hover border border-border">
                {file.type.startsWith('image/') || file.type === 'image/gif' ? (
                  <div 
                    className="cursor-pointer"
                    onClick={() => setMediaModal({ url: file.url, type: file.type, name: file.name })}
                  >
                    <img 
                      src={file.url} 
                      alt={file.name}
                      className="w-full h-auto max-h-96 object-contain hover:opacity-90 transition-opacity"
                    />
                  </div>
                ) : file.type.startsWith('video/') ? (
                  <div 
                    className="cursor-pointer"
                    onClick={() => setMediaModal({ url: file.url, type: file.type, name: file.name })}
                  >
                    <video 
                      src={file.url} 
                      className="w-full h-auto max-h-96 object-contain"
                      muted
                      loop
                      playsInline
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-10 h-10 bg-blue-500/10 rounded flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{file.name}</div>
                      <div className="text-xs text-muted">
                        {file.size < 10240 
                          ? `${(file.size / 1024).toFixed(1)} KB`
                          : `${(file.size / 1024 / 1024).toFixed(2)} MB`
                        }
                      </div>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        try {
                          // Fetch the file as a blob
                          const response = await fetch(file.url);
                          const blob = await response.blob();
                          
                          // Create a blob URL
                          const blobUrl = window.URL.createObjectURL(blob);
                          
                          // Create a temporary link element to trigger download
                          const link = document.createElement('a');
                          link.href = blobUrl;
                          link.download = file.name;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          
                          // Clean up the blob URL
                          window.URL.revokeObjectURL(blobUrl);
                        } catch (error) {
                          console.error('Error downloading file:', error);
                          // Fallback: open in new tab if download fails
                          window.open(file.url, '_blank');
                        }
                      }}
                      className="p-2 text-muted hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      }
    } catch (e) {
      // Not JSON, return null to render as regular text
    }
    return null;
  };

  const formatTime = (date: string) => {
    const messageDate = new Date(date);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const messageDay = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());
    
    const timeStr = messageDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    
    // Today: just time
    if (messageDay.getTime() === today.getTime()) {
      return timeStr;
    }
    
    // Yesterday: "Yesterday at HH:MM"
    if (messageDay.getTime() === yesterday.getTime()) {
      return `Yesterday at ${timeStr}`;
    }
    
    // Within a week: "Monday at HH:MM"
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    if (messageDay > oneWeekAgo) {
      const dayName = messageDate.toLocaleDateString([], { weekday: 'long' });
      return `${dayName} at ${timeStr}`;
    }
    
    // Within the year: "MM/DD, HH:MM"
    if (messageDay.getFullYear() === today.getFullYear()) {
      const dateStr = messageDate.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
      return `${dateStr}, ${timeStr}`;
    }
    
    // After the year: "MM/DD/YYYY, HH:MM"
    const dateStr = messageDate.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  };

  // Handle message click for selection
  const handleMessageClick = (messageId: string, isMe: boolean) => {
    if (!isMe) return;
    setSelectedMessageId(prev => prev === messageId ? null : messageId);
    setShowMessageMenu(prev => prev === messageId ? null : messageId);
  };

  // Start editing a message
  const startEditMessage = (message: Message) => {
    setEditingMessageId(message.id);
    setEditMessageContent(message.content);
    setShowMessageMenu(null);
    setSelectedMessageId(null);
    setReplyingToMessage(null);
  };

  // Start replying to a message
  const startReplyMessage = (message: Message) => {
    setReplyingToMessage(message);
    setShowMessageMenu(null);
    setSelectedMessageId(null);
  };

  // Scroll to a specific message when clicking a reply
  const scrollToMessage = (messageId: string) => {
    const element = document.querySelector(`[data-message-id="${messageId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight the message briefly
      element.classList.add('bg-accent/20');
      setTimeout(() => {
        element.classList.remove('bg-accent/20');
      }, 1500);
    }
  };

  // Cancel reply
  const cancelReplyMessage = () => {
    setReplyingToMessage(null);
  };

  // Cancel editing
  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditMessageContent("");
  };

  // Save edited message
  const saveEditMessage = async () => {
    if (!editingMessageId || !editMessageContent.trim()) return;

    const { error } = await supabase
      .from("messages")
      .update({
        content: editMessageContent.trim(),
        edited_at: new Date().toISOString(),
      })
      .eq("id", editingMessageId);

    if (error) {
      console.error("Error updating message:", error);
      return;
    }

    setMessages(prev => prev.map(m => 
      m.id === editingMessageId 
        ? { ...m, content: editMessageContent.trim(), edited_at: new Date().toISOString() }
        : m
    ));

    setEditingMessageId(null);
    setEditMessageContent("");
  };

  // Delete message
  const deleteMessage = async (messageId: string) => {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (error) {
      console.error("Error deleting message:", error);
      return;
    }

    setMessages(prev => prev.filter(m => m.id !== messageId));
    setShowMessageMenu(null);
    setSelectedMessageId(null);
  };

  // Add reaction to message
  const addReaction = async (messageId: string, reaction: string) => {
    if (!userId) return;

    const { data, error } = await supabase
      .from("reactions")
      .insert({
        message_id: messageId,
        user_id: userId,
        reaction: reaction,
      })
      .select()
      .single();

    if (error) {
      console.error("Error adding reaction:", error);
      return;
    }

    // Optimistically update UI
    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        const newReaction: Reaction = {
          id: data.id,
          message_id: messageId,
          user_id: userId,
          reaction: reaction,
          created_at: new Date().toISOString(),
        };
        return {
          ...m,
          reactions: [...(m.reactions || []), newReaction],
        };
      }
      return m;
    }));
  };

  // Remove reaction from message
  const removeReaction = async (messageId: string, reactionId: string) => {
    if (!userId) return;

    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("id", reactionId);

    if (error) {
      console.error("Error removing reaction:", error);
      return;
    }

    // Optimistically update UI
    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        return {
          ...m,
          reactions: m.reactions?.filter(r => r.id !== reactionId) || [],
        };
      }
      return m;
    }));
  };

  // Request notification permission on mount
  useEffect(() => {
    const checkNotificationPermission = async () => {
      await requestNotificationPermission();
    };
    checkNotificationPermission();
  }, []);

  // Clear selection when clicking elsewhere
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-message-container]')) {
        setSelectedMessageId(null);
        setShowMessageMenu(null);
        setShowReactionPicker(null);
      }
      // Close plus menu when clicking outside
      if (!target.closest('.plus-menu-container')) {
        setShowPlusMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

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
            <button
              onClick={() => router.push("/chats")}
              className="md:hidden p-2 -ml-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
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
            className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-accent/50 scrollbar-track-transparent hover:scrollbar-thumb-accent/70"
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
              messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  index={index}
                  messages={messages}
                  userId={userId}
                  myProfile={myProfile}
                  messageLayout={messageLayout}
                  selectedMessageId={selectedMessageId}
                  editingMessageId={editingMessageId}
                  editMessageContent={editMessageContent}
                  showMessageMenu={showMessageMenu}
                  showReactionPicker={showReactionPicker}
                  onSelectMessage={handleMessageClick}
                  onStartEdit={startEditMessage}
                  onStartReply={startReplyMessage}
                  onReplyClick={scrollToMessage}
                  onAddReaction={addReaction}
                  onRemoveReaction={removeReaction}
                  onSaveEdit={saveEditMessage}
                  onCancelEdit={cancelEditMessage}
                  onDelete={deleteMessage}
                  onSetEditContent={setEditMessageContent}
                  onToggleMenu={(id, isOpen) => setShowMessageMenu(isOpen ? id : null)}
                  onToggleReactionPicker={(id, isOpen) => setShowReactionPicker(isOpen ? id : null)}
                  formatTime={formatTime}
                  renderFileAttachments={renderFileAttachments}
                  extractTextContent={extractTextContent}
                />
              ))
            )}
            <div />
          </div>
        </div>

        <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-b border-border z-50">
          {replyingToMessage && (
            <div className="px-4 pt-3 pb-2 flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 text-sm text-muted bg-accent/10 rounded-lg px-3 py-2">
                <Reply className="w-4 h-4 text-accent" />
                <span className="truncate">
                  Replying to <span className="font-medium text-foreground">{replyingToMessage.profiles.display_name || `@${replyingToMessage.profiles.username}`}</span>: {replyingToMessage.content.slice(0, 50)}{replyingToMessage.content.length > 50 ? "..." : ""}
                </span>
              </div>
              <button
                onClick={cancelReplyMessage}
                className="p-1.5 text-muted hover:text-foreground hover:bg-card-hover rounded-md transition-colors"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          )}
          <form onSubmit={sendMessage} className="flex flex-col gap-3 p-4">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.gif,.pdf,.doc,.docx,.txt,.zip,.rar"
              onChange={handleFileSelect}
              className="hidden"
            />
            {/* File attachments preview */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 bg-background border border-border rounded-lg">
                {attachedFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 bg-card-hover border border-border rounded-md p-2">
                    <div className="flex items-center gap-2">
                      {file.type.startsWith('image/') ? (
                        <div className="w-8 h-8 bg-accent/10 rounded flex items-center justify-center">
                          <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      ) : file.type.startsWith('video/') ? (
                        <div className="w-8 h-8 bg-red-500/10 rounded flex items-center justify-center">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      ) : (
                        <div className="w-8 h-8 bg-blue-500/10 rounded flex items-center justify-center">
                          <Paperclip className="w-4 h-4 text-blue-500" />
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-foreground truncate max-w-[150px]">{file.name}</span>
                        <span className="text-xs text-muted">
                          {file.size < 10240 
                            ? `${(file.size / 1024).toFixed(1)} KB`
                            : `${(file.size / 1024 / 1024).toFixed(2)} MB`
                          }
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== index))}
                      className="p-1 text-muted hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-3">
              <div className="relative flex-1 plus-menu-container">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={replyingToMessage ? "Type your reply..." : "Type a message..."}
                  className="w-full px-4 py-3 pr-12 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-accent text-foreground placeholder:text-muted transition-all"
                  autoFocus={!!replyingToMessage}
                />
                
                {/* Plus Menu Button */}
                <button
                  type="button"
                  onClick={() => setShowPlusMenu(!showPlusMenu)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                  title="More options"
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </button>
                
                {/* Plus Menu Dropdown */}
                {showPlusMenu && (
                  <div 
                    className="absolute top-0 right-0 bg-card border border-border rounded-lg shadow-lg p-1 z-50 min-w-[200px]"
                    onMouseEnter={(e) => e.stopPropagation()}
                    onMouseLeave={(e) => {
                      e.stopPropagation();
                      setShowPlusMenu(false);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                        setShowPlusMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-card-hover rounded-md transition-colors text-left"
                    >
                      <Paperclip className="w-4 h-4 text-muted" />
                      <span className="text-sm">Attach file</span>
                    </button>
                  </div>
                )}
              </div>
              
              <button
                type="submit"
                disabled={(!newMessage.trim() && attachedFiles.length === 0) || isUploading}
                className="md:hidden p-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Media Modal */}
      {mediaModal && (
        <div 
          className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            // Only close if clicking directly on the backdrop (the div itself)
            if (e.target === e.currentTarget) {
              setMediaModal(null);
            }
          }}
        >
          <div 
            className="relative max-w-6xl max-h-full w-full h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setMediaModal(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            {/* Download button */}
            <button
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                  // Fetch the file as a blob
                  const response = await fetch(mediaModal.url);
                  const blob = await response.blob();
                  
                  // Create a blob URL
                  const blobUrl = window.URL.createObjectURL(blob);
                  
                  // Create a temporary link element to trigger download
                  const link = document.createElement('a');
                  link.href = blobUrl;
                  link.download = mediaModal.name;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  
                  // Clean up the blob URL
                  window.URL.revokeObjectURL(blobUrl);
                } catch (error) {
                  console.error('Error downloading file:', error);
                  // Fallback: open in new tab if download fails
                  window.open(mediaModal.url, '_blank');
                }
              }}
              className="absolute top-4 right-16 z-10 p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            
            {/* Media content */}
            {mediaModal.type.startsWith('image/') || mediaModal.type === 'image/gif' ? (
              <img 
                src={mediaModal.url} 
                alt={mediaModal.name}
                className="max-w-full max-h-full object-contain"
              />
            ) : mediaModal.type.startsWith('video/') ? (
              <video 
                src={mediaModal.url} 
                controls
                autoPlay
                className="max-w-full max-h-full object-contain"
              >
                Your browser does not support the video tag.
              </video>
            ) : null}
          </div>
        </div>
      )}

      {/* Group Settings Modal */}
      {showGroupSettings && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start md:items-center justify-center z-50 md:p-4"
          onClick={() => setShowGroupSettings(false)}
        >
          <div 
            className="bg-card border-0 md:border md:border-border md:rounded-2xl w-full h-full md:h-auto md:max-w-md md:max-h-[80vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowGroupSettings(false)}
                  className="md:hidden p-2 -ml-2 text-muted hover:text-foreground hover:bg-card-hover rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-semibold text-foreground">Group Settings</h2>
              </div>
              <button
                onClick={() => setShowGroupSettings(false)}
                className="hidden md:block text-muted hover:text-foreground transition-colors"
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
