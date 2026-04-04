// Unread message indicator components

export function UnreadDot() {
  return (
    <div className="w-2 h-2 bg-accent rounded-full flex-shrink-0" />
  );
}

export function UnreadCount({ count }: { count: number }) {
  return (
    <div className="min-w-[20px] h-5 bg-accent rounded-full flex items-center justify-center text-xs text-white font-medium">
      {count > 99 ? '99+' : count}
    </div>
  );
}
