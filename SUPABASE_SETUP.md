# Supabase Setup Instructions

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Choose your organization and give it a name (e.g., "mira-chat")
4. Set a secure database password
5. Choose a region close to your users
6. Click "Create new project"

## 2. Get Your API Keys

Once your project is ready:

1. Go to Project Settings (gear icon) → API
2. Copy these values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 3. Set Up the Database

1. Go to the SQL Editor in your Supabase dashboard
2. Open a "New query"
3. Copy the entire contents of `supabase/schema.sql` from this project
4. Paste it into the SQL Editor
5. Click "Run"

This will create:
- `profiles` table (extends auth.users with usernames)
- `chats` table
- `chat_participants` table
- `messages` table
- Row Level Security policies
- Trigger to auto-create profile on signup

## 4. Configure Environment Variables

Create a `.env.local` file in your project root:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Replace with your actual values from step 2.

## 5. Enable Real-time (for live messages)

1. In Supabase dashboard, go to Database → Replication
2. Toggle "Realtime" to ON for the `messages` table
3. Or run this SQL:

```sql
begin;
  -- Add messages table to realtime publication
  alter publication supabase_realtime add table messages;
commit;
```

## 6. Run the App

```bash
npm run dev
```

Visit `http://localhost:3000`

## Features

- **Signup with username**: Users pick a unique username during signup
- **Create chats**: Search by username to add people to chats (1-on-1 or group)
- **Real-time messaging**: Messages appear instantly without refresh
- **Secure**: Row Level Security ensures users only see their own chats
