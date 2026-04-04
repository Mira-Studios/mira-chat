// Skeleton loading components for seamless UI transitions

export function ChatSkeleton() {
  return (
    <div className="block p-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-border rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 bg-border rounded w-3/4" />
          <div className="h-3 bg-border rounded w-1/2" />
        </div>
        <div className="w-4 h-4 bg-border rounded shrink-0" />
      </div>
    </div>
  );
}

export function ChatListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <ChatSkeleton key={i} />
      ))}
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="flex items-center gap-3 animate-pulse">
      <div className="w-10 h-10 bg-border rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="h-4 bg-border rounded w-1/2" />
        <div className="h-3 bg-border rounded w-1/3" />
      </div>
    </div>
  );
}

export function SearchSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="w-full p-3 border border-border rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-border rounded-full" />
            <div className="h-4 bg-border rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
