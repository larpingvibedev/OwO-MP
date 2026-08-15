-- ==============================================================================
-- OWO MUSIC PLAYER - SUPABASE CLOUD SYNC & HANDOFF SCHEMA
-- Paste and run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- ==============================================================================

-- 1. PROFILES TABLE (User metadata & avatars)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Automatically create profile on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. USER PLAYLISTS (Cross-device synced playlists)
CREATE TABLE IF NOT EXISTS public.user_playlists (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cover_art TEXT,
  tracks JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own playlists"
  ON public.user_playlists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. USER FAVORITES / LIKED SONGS
CREATE TABLE IF NOT EXISTS public.user_favorites (
  id TEXT PRIMARY KEY, -- usually "user_id:track_id"
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  track_id TEXT NOT NULL,
  track_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own favorites"
  ON public.user_favorites FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. LIVE PLAYBACK STATE (Realtime device sync & Spotify Connect style handoff)
CREATE TABLE IF NOT EXISTS public.user_playback_state (
  user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  active_device_id TEXT NOT NULL,
  active_device_name TEXT,
  current_track JSONB,
  current_position NUMERIC DEFAULT 0,
  is_playing BOOLEAN DEFAULT false,
  queue JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_playback_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own playback state"
  ON public.user_playback_state FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. USER DEVICES (Async & Live status across all user hardware)
CREATE TABLE IF NOT EXISTS public.user_devices (
  id TEXT PRIMARY KEY, -- device_id (e.g. dev_12345)
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL, -- desktop / mobile / web
  current_track JSONB,
  current_position NUMERIC DEFAULT 0,
  is_playing BOOLEAN DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own devices"
  ON public.user_devices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable Supabase Realtime for instant cross-device updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_playlists;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_favorites;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_playback_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_devices;
