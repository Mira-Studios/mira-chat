"use client";

import { MessageSquare } from "lucide-react";

export default function ChatsIndexPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center p-8">
        <div className="w-20 h-20 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="w-10 h-10 text-accent" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Select a chat</h2>
        <p className="text-muted">Choose a conversation from the sidebar or start a new one.</p>
      </div>
    </div>
  );
}
